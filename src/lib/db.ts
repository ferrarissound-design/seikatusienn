import Dexie, { type Table } from "dexie";
import { z } from "zod";
import type { AnyRecord, DataMap, Kind, RecordOf } from "../types";

const text = z.string().trim().min(1).max(1000);
const memo = z.string().max(10000);
const date = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "日付を確認してください",
  );
const optionalDate = z.union([date, z.literal("")]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.number().int().min(0).max(999999999999);
const id = z.string().min(1).max(200);
export const dataSchemas = {
  task: z
    .object({
      title: text,
      due: optionalDate,
      priority: z.enum(["low", "normal", "high"]),
      category: z.string().max(200),
      memo,
      completed: z.boolean(),
      completedAt: z.string().datetime({ offset: true }).optional(),
      repeat: z.enum(["none", "daily", "weekly", "monthly"]),
      steps: z
        .array(z.object({ id, title: text, done: z.boolean() }).strict())
        .max(200)
        .refine(
          (items) =>
            new Set(items.map((item) => item.id)).size === items.length,
          "作業IDが重複しています",
        ),
    })
    .strict(),
  checklist: z
    .object({
      title: text,
      items: z
        .array(z.object({ id, title: text, checked: z.boolean() }).strict())
        .max(300)
        .refine(
          (items) =>
            new Set(items.map((item) => item.id)).size === items.length,
          "持ち物IDが重複しています",
        ),
      resetTime: time,
      lastReset: optionalDate,
    })
    .strict(),
  checkHistory: z
    .object({
      checklistId: id,
      title: text,
      date,
      checked: z.number().int().min(0),
      total: z.number().int().min(0),
      items: z
        .array(z.object({ title: text, checked: z.boolean() }).strict())
        .max(300),
    })
    .strict()
    .refine(
      (v) =>
        v.checked <= v.total &&
        v.total === v.items.length &&
        v.checked === v.items.filter((x) => x.checked).length,
    ),
  transaction: z
    .object({
      type: z.enum(["expense", "income"]),
      amount: money.positive(),
      category: text,
      memo,
      date,
      fixedCostId: id.optional(),
      fixedPeriod: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
    })
    .strict(),
  fixedCost: z
    .object({
      title: text,
      amount: money.positive(),
      day: z.number().int().min(1).max(31),
    })
    .strict(),
  settings: z
    .object({
      balance: money,
      balanceDate: date,
      monthlyBudget: money,
      payday: z.number().int().min(1).max(31),
      savings: money,
      savingsTitle: z.string().max(1000),
      theme: z.enum(["light", "dark", "system"]),
      reduceMotion: z.boolean(),
      features: z
        .object({
          checklist: z.boolean(),
          tasks: z.boolean(),
          money: z.boolean(),
        })
        .strict(),
      onboarded: z.boolean(),
      lastBackup: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  reminder: z
    .object({
      title: text,
      date: optionalDate,
      time,
      enabled: z.boolean(),
      type: z.enum([
        "checklist",
        "task",
        "repeat",
        "payment",
        "payday",
        "expense",
      ]),
      acknowledgedOn: date.optional(),
    })
    .strict(),
};
const baseSchema = z
  .object({
    id,
    owner: id,
    kind: z.enum([
      "task",
      "checklist",
      "checkHistory",
      "transaction",
      "fixedCost",
      "settings",
      "reminder",
    ]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    deleted: z.boolean(),
    data: z.unknown(),
  })
  .strict();
export function validateRecord(value: unknown): AnyRecord {
  const base = baseSchema.parse(value);
  return {
    ...base,
    data: dataSchemas[base.kind].parse(base.data),
  } as AnyRecord;
}
export type StoredRecord = AnyRecord & { serverRevision: number };
export interface OutboxEntry {
  mutationId: string;
  owner: string;
  id: string;
  expectedRevision: number;
  record: AnyRecord;
  sequence: number;
}
export interface Conflict {
  id: string;
  owner: string;
  recordId: string;
  local: AnyRecord;
  remote: AnyRecord;
  remoteRevision: number;
  source: "sync" | "backup";
  createdAt: string;
  resolved: boolean;
}
interface MetaEntry {
  key: string;
  value: string;
}
export class LifePartnerDB extends Dexie {
  records!: Table<StoredRecord, [string, string]>;
  outbox!: Table<OutboxEntry, string>;
  conflicts!: Table<Conflict, string>;
  meta!: Table<MetaEntry, string>;
  constructor(name = "life-partner") {
    super(name);
    this.version(1).stores({
      records: "[owner+id],owner,kind",
      outbox: "mutationId,owner,[owner+id],sequence",
    });
    this.version(2).stores({
      records: "[owner+id],owner,kind",
      outbox: "mutationId,owner,[owner+id],sequence",
      conflicts: "id,owner,[owner+recordId]",
      meta: "key",
    });
  }
}
export const db = new LifePartnerDB();
export const plainRecord = (r: StoredRecord | AnyRecord): AnyRecord => {
  const { id, owner, kind, createdAt, updatedAt, version, deleted, data } = r;
  return {
    id,
    owner,
    kind,
    createdAt,
    updatedAt,
    version,
    deleted,
    data,
  } as AnyRecord;
};
export async function getRecords(owner: string): Promise<AnyRecord[]> {
  return (await db.records.where("owner").equals(owner).toArray()).map(
    plainRecord,
  );
}
export async function getPendingCount(owner: string) {
  return db.outbox.where("owner").equals(owner).count();
}
export async function getConflicts(owner: string) {
  return (await db.conflicts.where("owner").equals(owner).toArray()).filter(
    (c) => !c.resolved,
  );
}
export async function enqueueRecord(record: AnyRecord, serverRevision: number) {
  const pending = await db.outbox
    .where("[owner+id]")
    .equals([record.owner, record.id])
    .toArray();
  const previous = pending.sort((a, b) => a.sequence - b.sequence).at(-1);
  const expectedRevision = previous
    ? previous.expectedRevision + 1
    : serverRevision;
  await db.outbox.add({
    mutationId: crypto.randomUUID(),
    owner: record.owner,
    id: record.id,
    record: structuredClone(record),
    expectedRevision,
    sequence: previous ? previous.sequence + 1 : Date.now(),
  });
}
async function putRecord(record: AnyRecord, serverRevision: number) {
  await db.records.put({ ...record, serverRevision } as StoredRecord);
  await enqueueRecord(record, serverRevision);
}
export async function saveRecord<K extends Kind>(
  owner: string,
  kind: K,
  data: DataMap[K],
  recordId: string = kind === "settings" ? "settings" : crypto.randomUUID(),
): Promise<void> {
  const parsed = dataSchemas[kind].parse(data) as DataMap[K];
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const existing = await db.records.get([owner, recordId]);
    if (existing && existing.kind !== kind)
      throw new Error("記録の種類が一致しません");
    if ((await getConflicts(owner)).some((c) => c.recordId === recordId))
      throw new Error("この記録は競合を確認してから編集してください");
    const now = new Date().toISOString();
    const record = {
      id: recordId,
      owner,
      kind,
      data: parsed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
      deleted: false,
    } as RecordOf<K>;
    await putRecord(record as AnyRecord, existing?.serverRevision ?? 0);
  });
}
async function setDeleted(record: AnyRecord, deleted: boolean) {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const current = await db.records.get([record.owner, record.id]);
    if (!current) throw new Error("記録が見つかりません");
    if (
      (await getConflicts(record.owner)).some((c) => c.recordId === record.id)
    )
      throw new Error("競合を確認してから変更してください");
    await putRecord(
      {
        ...plainRecord(current),
        deleted,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      } as AnyRecord,
      current.serverRevision,
    );
  });
}
export const deleteRecord = (record: AnyRecord) => setDeleted(record, true);
export const restoreRecord = (record: AnyRecord) => setDeleted(record, false);
export async function clearOwner(owner: string) {
  await db.transaction(
    "rw",
    db.records,
    db.outbox,
    db.conflicts,
    db.meta,
    async () => {
      await db.records.where("owner").equals(owner).delete();
      await db.outbox.where("owner").equals(owner).delete();
      await db.conflicts.where("owner").equals(owner).delete();
      await db.meta.where("key").startsWith(`${owner}:`).delete();
    },
  );
}
export async function resolveConflict(
  conflictId: string,
  choice: "local" | "remote",
) {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const conflict = await db.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) return;
    const current = await db.records.get([conflict.owner, conflict.recordId]);
    if (
      choice === "remote" &&
      conflict.source === "backup" &&
      current &&
      current.kind !== conflict.remote.kind
    ) {
      // IDs have immutable kinds in the cloud. Keep the existing record and import
      // the chosen backup variant with a fresh identity instead of destroying it.
      const now = new Date().toISOString();
      const imported = {
        ...conflict.remote,
        id: crypto.randomUUID(),
        owner: conflict.owner,
        version: 1,
        createdAt: now,
        updatedAt: now,
      } as AnyRecord;
      await putRecord(imported, 0);
      await db.conflicts.update(conflictId, { resolved: true });
      return;
    }
    await db.outbox
      .where("[owner+id]")
      .equals([conflict.owner, conflict.recordId])
      .delete();
    if (choice === "remote" && conflict.source === "sync") {
      await db.records.put({
        ...conflict.remote,
        serverRevision: conflict.remoteRevision,
      } as StoredRecord);
    } else {
      const selected =
        choice === "remote"
          ? conflict.remote
          : current
            ? plainRecord(current)
            : conflict.local;
      const record = {
        ...selected,
        owner: conflict.owner,
        version: Math.max(selected.version, current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      } as AnyRecord;
      await putRecord(
        record,
        conflict.source === "sync"
          ? conflict.remoteRevision
          : (current?.serverRevision ?? 0),
      );
    }
    await db.conflicts.update(conflictId, { resolved: true });
  });
}
