import { createClient } from "@supabase/supabase-js";
import type { AnyRecord } from "../types";
import {
  db,
  plainRecord,
  validateRecord,
  type Conflict,
  type StoredRecord,
} from "./db";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase =
  url && key && /^https:\/\//.test(url)
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
export interface SyncReport {
  sent: number;
  received: number;
  conflicts: number;
  status: "synced" | "offline" | "local" | "error";
  message?: string;
}
export interface CloudRow {
  owner: string;
  id: string;
  kind: AnyRecord["kind"];
  data: unknown;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
  revision: number;
}
export function fromCloud(row: CloudRow): StoredRecord {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1)
    throw new Error("クラウドのバージョン形式が不正です");
  return {
    ...validateRecord({
      id: row.id,
      owner: row.owner,
      kind: row.kind,
      data: row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deleted: row.deleted,
    }),
    serverRevision: row.revision,
  } as StoredRecord;
}
export async function quarantine(
  local: AnyRecord,
  remote: AnyRecord,
  remoteRevision: number,
  source: "sync" | "backup",
) {
  const existing = (
    await db.conflicts
      .where("[owner+recordId]")
      .equals([local.owner, local.id])
      .toArray()
  ).find((c) => !c.resolved);
  if (existing) return;
  const conflict: Conflict = {
    id: crypto.randomUUID(),
    owner: local.owner,
    recordId: local.id,
    local: structuredClone(local),
    remote: structuredClone(remote),
    remoteRevision,
    source,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
  await db.conflicts.add(conflict);
}
export function sameRecord(a: AnyRecord, b: AnyRecord) {
  return (
    a.kind === b.kind &&
    a.deleted === b.deleted &&
    JSON.stringify(a.data) === JSON.stringify(b.data)
  );
}
const active = new Map<string, Promise<SyncReport>>();
const paused = new Map<string, number>();
export async function pauseSyncOwner(owner: string): Promise<() => void> {
  paused.set(owner, (paused.get(owner) ?? 0) + 1);
  await active.get(owner);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (paused.get(owner) ?? 1) - 1;
    if (count) paused.set(owner, count);
    else paused.delete(owner);
  };
}
export function syncOwner(owner: string): Promise<SyncReport> {
  if (paused.has(owner))
    return Promise.resolve({
      sent: 0,
      received: 0,
      conflicts: 0,
      status: "error",
      message: "データ整理中のため同期を一時停止しています",
    });
  const existing = active.get(owner);
  if (existing) return existing;
  const job = performSync(owner).finally(() => active.delete(owner));
  active.set(owner, job);
  return job;
}
async function performSync(owner: string): Promise<SyncReport> {
  const report: SyncReport = {
    sent: 0,
    received: 0,
    conflicts: 0,
    status: "synced",
  };
  if (!supabase || owner === "local") return { ...report, status: "local" };
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return { ...report, status: "offline" };
  try {
    if (await db.meta.get(`${owner}:deletionPending`))
      return {
        ...report,
        status: "error",
        message:
          "データの削除手続きを確認しています。設定から削除を再試行してください。記録の再送信は停止しています。",
      };
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (
      sessionError ||
      sessionData.session?.user.id !== owner ||
      !sessionData.session.access_token
    )
      throw new Error("認証が必要です");
    // Pin the token to this owner for the whole run. The shared Supabase client
    // may switch accounts while a request is awaiting the network.
    const authorization = `Bearer ${sessionData.session.access_token}`;
    const assertCurrentOwner = async () => {
      if (await db.meta.get(`${owner}:deletionPending`))
        throw new Error("削除手続き中です");
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== owner)
        throw new Error("アカウントが切り替わりました");
    };
    const queue = (await db.outbox.where("owner").equals(owner).toArray()).sort(
      (a, b) => a.sequence - b.sequence,
    );
    const blocked = new Set(
      (await db.conflicts.where("owner").equals(owner).toArray())
        .filter((c) => !c.resolved)
        .map((c) => c.recordId),
    );
    for (const entry of queue) {
      if (blocked.has(entry.id)) continue;
      const r = entry.record;
      await assertCurrentOwner();
      const { data, error } = await supabase
        .rpc("life_partner_sync", {
          p_id: r.id,
          p_kind: r.kind,
          p_data: r.data,
          p_created_at: r.createdAt,
          p_updated_at: r.updatedAt,
          p_version: r.version,
          p_deleted: r.deleted,
          p_expected_revision: entry.expectedRevision,
          p_mutation_id: entry.mutationId,
        })
        .setHeader("Authorization", authorization);
      if (error) throw new Error("同期を完了できませんでした");
      if (!data || !["ok", "conflict"].includes(data.status))
        throw new Error("同期応答を確認できませんでした");
      const remote =
        data.status === "conflict" && data.record === null
          ? ({
              ...r,
              deleted: true,
              updatedAt: new Date().toISOString(),
              version: r.version + 1,
              serverRevision: 0,
            } as StoredRecord)
          : fromCloud(data.record as CloudRow);
      if (remote.owner !== owner || remote.id !== r.id)
        throw new Error("同期応答が記録と一致しません");
      if (data.status === "conflict") {
        await db.transaction("rw", db.records, db.conflicts, async () => {
          const current = await db.records.get([owner, r.id]);
          if (current)
            await quarantine(
              plainRecord(current),
              plainRecord(remote),
              remote.serverRevision,
              "sync",
            );
        });
        blocked.add(r.id);
        report.conflicts++;
        continue;
      }
      await db.transaction("rw", db.records, db.outbox, async () => {
        // Acknowledgement is durable before the immutable mutation is removed.
        const current = await db.records.get([owner, r.id]);
        if (current)
          await db.records.update([owner, r.id], {
            serverRevision: Math.max(
              current.serverRevision,
              remote.serverRevision,
            ),
          });
        await db.outbox.delete(entry.mutationId);
      });
      report.sent++;
    }
    let offset = 0;
    const pageSize = 500;
    while (true) {
      await assertCurrentOwner();
      const { data, error } = await supabase
        .from("life_partner_records")
        .select("*")
        .eq("owner", owner)
        .order("id")
        .range(offset, offset + pageSize - 1)
        .setHeader("Authorization", authorization);
      if (error) throw new Error("クラウドの記録を取得できませんでした");
      for (const raw of data ?? []) {
        const remote = fromCloud(raw as CloudRow);
        if (remote.owner !== owner) throw new Error("所有者が一致しません");
        await db.transaction(
          "rw",
          db.records,
          db.outbox,
          db.conflicts,
          async () => {
            const current = await db.records.get([owner, remote.id]);
            if (!current) {
              await db.records.put(remote);
              report.received++;
              return;
            }
            if (remote.serverRevision <= current.serverRevision) return;
            const pending = await db.outbox
              .where("[owner+id]")
              .equals([owner, remote.id])
              .count();
            if (pending) {
              await quarantine(
                plainRecord(current),
                plainRecord(remote),
                remote.serverRevision,
                "sync",
              );
              report.conflicts++;
            } else {
              await db.records.put(remote);
              report.received++;
            }
          },
        );
      }
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }
    await db.meta.put({
      key: `${owner}:lastSync`,
      value: new Date().toISOString(),
    });
    return report;
  } catch {
    return {
      ...report,
      status: "error",
      message:
        "同期できませんでした。記録は端末に残っています。接続を確認して再試行してください。",
    };
  }
}
