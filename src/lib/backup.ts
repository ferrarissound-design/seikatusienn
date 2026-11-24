import { z } from "zod";
import type { AnyRecord } from "../types";
import {
  db,
  getRecords,
  plainRecord,
  validateRecord,
  enqueueRecord,
  type StoredRecord,
  type Conflict,
} from "./db";
import { quarantine, sameRecord } from "./sync";
export interface Backup {
  format: "life-partner";
  version: 1;
  exportedAt: string;
  records: AnyRecord[];
  conflicts?: Conflict[];
}
export interface BackupPreview {
  newRecords: number;
  duplicates: number;
  conflicts: number;
}
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_BACKUP_RECORDS = 50000;
export async function exportBackup(owner: string): Promise<string> {
  return db.transaction("r", db.records, db.conflicts, async () => {
    // Capture records and every conflict variant from one IndexedDB snapshot.
    const backup: Backup = {
      format: "life-partner",
      version: 1,
      exportedAt: new Date().toISOString(),
      records: await getRecords(owner),
      conflicts: await db.conflicts.where("owner").equals(owner).toArray(),
    };
    if (
      backup.records.length > MAX_BACKUP_RECORDS ||
      (backup.conflicts?.length ?? 0) > MAX_BACKUP_RECORDS
    )
      throw new Error(
        "全データのバックアップが対応上限（記録・競合それぞれ50,000件）を超えました。ファイルは作成していません。端末内の記録は保持されています。",
      );
    const serialized = JSON.stringify(backup, null, 2);
    if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES)
      throw new Error(
        "全データのバックアップが対応上限（20MB）を超えました。ファイルは作成していません。端末内の記録は保持されています。",
      );
    return serialized;
  });
}
export function parseBackup(text: string): Backup {
  if (
    text.length > MAX_BACKUP_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES
  )
    throw new Error("バックアップは20MB以内のファイルを選んでください");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON形式のファイルを選んでください");
  }
  const envelope = z
    .object({
      format: z.literal("life-partner"),
      version: z.literal(1),
      exportedAt: z.string().datetime({ offset: true }),
      records: z.array(z.unknown()).max(MAX_BACKUP_RECORDS),
      conflicts: z.array(z.unknown()).max(MAX_BACKUP_RECORDS).optional(),
    })
    .strict()
    .safeParse(raw);
  if (!envelope.success)
    throw new Error("Life Partnerのバックアップ形式を確認してください");
  let records: AnyRecord[];
  try {
    records = envelope.data.records.map(validateRecord);
  } catch {
    throw new Error(
      "バックアップに不正な記録が含まれています。復元は実行されませんでした",
    );
  }
  const recordIds = new Set(records.map((r) => r.id));
  if (recordIds.size !== records.length)
    throw new Error("バックアップに重複したIDが含まれています");
  const conflictSchema = z
    .object({
      id: z.string().min(1).max(1000),
      owner: z.string().min(1).max(200),
      recordId: z.string().min(1).max(200),
      local: z.unknown(),
      remote: z.unknown(),
      remoteRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      source: z.enum(["sync", "backup"]),
      createdAt: z.string().datetime({ offset: true }),
      resolved: z.boolean(),
    })
    .strict();
  let conflicts: Conflict[];
  try {
    conflicts = (envelope.data.conflicts ?? []).map((raw) => {
      const parsed = conflictSchema.parse(raw);
      const local = validateRecord(parsed.local);
      const remote = validateRecord(parsed.remote);
      if (
        local.owner !== parsed.owner ||
        remote.owner !== parsed.owner ||
        local.id !== parsed.recordId ||
        remote.id !== parsed.recordId ||
        !recordIds.has(parsed.recordId)
      )
        throw new Error("invalid conflict");
      return { ...parsed, local, remote };
    });
  } catch {
    throw new Error("バックアップの競合記録が不正です");
  }
  return { ...envelope.data, records, conflicts };
}
export async function previewBackup(
  owner: string,
  backup: Backup,
): Promise<BackupPreview> {
  const preview = { newRecords: 0, duplicates: 0, conflicts: 0 };
  for (const record of backup.records) {
    const existing = await db.records.get([owner, record.id]);
    if (!existing) preview.newRecords++;
    else if (sameRecord(existing, record)) preview.duplicates++;
    else preview.conflicts++;
  }
  return preview;
}
export async function restoreBackup(
  owner: string,
  backup: Backup,
): Promise<BackupPreview> {
  // Validate again at the mutation boundary; callers cannot bypass the file parser.
  const verified = parseBackup(JSON.stringify(backup));
  return db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const result: BackupPreview = {
      newRecords: 0,
      duplicates: 0,
      conflicts: 0,
    };
    for (const source of verified.records) {
      const incoming = { ...source, owner } as AnyRecord;
      const existing = await db.records.get([owner, incoming.id]);
      if (!existing) {
        await db.records.add({
          ...incoming,
          serverRevision: 0,
        } as StoredRecord);
        await enqueueRecord(incoming, 0);
        result.newRecords++;
      } else if (sameRecord(existing, incoming)) result.duplicates++;
      else {
        await quarantine(
          plainRecord(existing),
          incoming,
          existing.serverRevision,
          "backup",
        );
        result.conflicts++;
      }
    }
    // Keep both variants, including resolved history, in complete backups.
    const existingConflicts = await db.conflicts
      .where("owner")
      .equals(owner)
      .toArray();
    for (const source of verified.conflicts ?? []) {
      const duplicate = existingConflicts.some(
        (c) =>
          c.recordId === source.recordId &&
          c.createdAt === source.createdAt &&
          sameRecord(c.local, source.local) &&
          sameRecord(c.remote, source.remote),
      );
      if (duplicate) continue;
      const alreadyActive = existingConflicts.some(
        (c) => c.recordId === source.recordId && !c.resolved,
      );
      const restored: Conflict = {
        ...source,
        id: crypto.randomUUID(),
        owner,
        local: { ...source.local, owner } as AnyRecord,
        remote: { ...source.remote, owner } as AnyRecord,
        source: "backup",
        resolved: source.resolved || alreadyActive,
      };
      await db.conflicts.add(restored);
      existingConflicts.push(restored);
    }
    return result;
  });
}
function csvCell(value: string | number) {
  const source = String(value);
  // Neutralize spreadsheet formula injection in user-entered text.
  const safe = /^[=+\-@\t\r]/.test(source) ? `'${source}` : source;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportTransactionsCSV(owner: string): Promise<string> {
  const records = (await getRecords(owner)).filter(
    (r) => r.kind === "transaction" && !r.deleted,
  );
  const lines = [
    ["日付", "種類", "金額（円）", "カテゴリー", "メモ", "ID"]
      .map(csvCell)
      .join(","),
  ];
  for (const r of records)
    if (r.kind === "transaction")
      lines.push(
        [
          r.data.date,
          r.data.type === "expense" ? "支出" : "収入",
          r.data.amount,
          r.data.category,
          r.data.memo,
          r.id,
        ]
          .map(csvCell)
          .join(","),
      );
  return "\uFEFF" + lines.join("\r\n");
}
