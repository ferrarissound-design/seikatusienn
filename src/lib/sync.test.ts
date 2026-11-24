import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  saveRecord,
  getRecords,
  getPendingCount,
  getConflicts,
  resolveConflict,
} from "./db";
import type { TaskData } from "../types";
import type { CloudRow } from "./sync";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: vi.fn(),
  range: vi.fn(),
  headers: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getSession: mock.session },
    rpc: (...args: unknown[]) => ({
      setHeader: (_name: string, value: string) => {
        mock.headers(value);
        return mock.rpc(...args);
      },
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: (...args: unknown[]) => ({
              setHeader: (_name: string, value: string) => {
                mock.headers(value);
                return mock.range(...args);
              },
            }),
          }),
        }),
      }),
    }),
  }),
}));
let syncOwner: typeof import("./sync").syncOwner;
let clouds: Map<string, CloudRow>;
let acks: Map<string, { status: "ok" | "conflict"; record: CloudRow }>;
const owner = "fake-user";
const task: TaskData = {
  title: "架空のタスク",
  due: "",
  priority: "normal",
  category: "生活",
  memo: "",
  completed: false,
  repeat: "none",
  steps: [],
};
let disconnectAfterCommit = false;
beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "fake-public-key");
  syncOwner = (await import("./sync")).syncOwner;
});
beforeEach(async () => {
  mock.rpc.mockClear();
  mock.session.mockClear();
  mock.range.mockClear();
  mock.headers.mockClear();
  await db.delete();
  await db.open();
  clouds = new Map();
  acks = new Map();
  disconnectAfterCommit = false;
  mock.session.mockResolvedValue({
    data: {
      session: { user: { id: owner }, access_token: "owner-a-test-token" },
    },
    error: null,
  });
  mock.range.mockImplementation(async () => ({
    data: Array.from(clouds.values()),
    error: null,
  }));
  mock.rpc.mockImplementation(
    async (_name: string, p: Record<string, unknown>) => {
      const mutation = p.p_mutation_id as string;
      if (acks.has(mutation)) return { data: acks.get(mutation), error: null };
      const existing = clouds.get(p.p_id as string);
      if ((existing?.revision ?? 0) !== p.p_expected_revision)
        return { data: { status: "conflict", record: existing }, error: null };
      const row: CloudRow = {
        id: p.p_id as string,
        owner,
        kind: p.p_kind as CloudRow["kind"],
        data: p.p_data,
        created_at: p.p_created_at as string,
        updated_at: p.p_updated_at as string,
        version: p.p_version as number,
        deleted: p.p_deleted as boolean,
        revision: (existing?.revision ?? 0) + 1,
      };
      clouds.set(row.id, row);
      const result = { status: "ok" as const, record: row };
      acks.set(mutation, result);
      if (disconnectAfterCommit) {
        disconnectAfterCommit = false;
        throw new Error("network interrupted");
      }
      return { data: result, error: null };
    },
  );
});
describe("sync safety with a deterministic fake CAS server", () => {
  it("keeps queued mutations after a lost acknowledgement and retries idempotently", async () => {
    await saveRecord(owner, "task", task, "one");
    disconnectAfterCommit = true;
    expect((await syncOwner(owner)).status).toBe("error");
    expect(await getPendingCount(owner)).toBe(1);
    expect(clouds.size).toBe(1);
    expect((await syncOwner(owner)).status).toBe("synced");
    expect(await getPendingCount(owner)).toBe(0);
    expect(clouds.get("one")?.revision).toBe(1);
    await syncOwner(owner);
    expect(clouds.get("one")?.revision).toBe(1);
  });
  it("uploads ordered offline edits and tombstone exactly once", async () => {
    await saveRecord(owner, "task", task, "one");
    await saveRecord(owner, "task", { ...task, title: "変更" }, "one");
    const { deleteRecord } = await import("./db");
    await deleteRecord((await getRecords(owner))[0]);
    expect((await syncOwner(owner)).sent).toBe(3);
    expect(clouds.get("one")?.deleted).toBe(true);
    expect(await getPendingCount(owner)).toBe(0);
  });
  it("preserves local and remote conflict data and waits for explicit resolution", async () => {
    await saveRecord(owner, "task", task, "one");
    await syncOwner(owner);
    await saveRecord(owner, "task", { ...task, title: "端末での変更" }, "one");
    const row = clouds.get("one")!;
    clouds.set("one", {
      ...row,
      revision: 2,
      data: { ...task, title: "別端末での変更" },
    });
    expect((await syncOwner(owner)).conflicts).toBeGreaterThan(0);
    expect((await getRecords(owner))[0].data).toEqual({
      ...task,
      title: "端末での変更",
    });
    expect(await getPendingCount(owner)).toBe(1);
    const [conflict] = await getConflicts(owner);
    expect(conflict.remote.data).toEqual({ ...task, title: "別端末での変更" });
    await resolveConflict(conflict.id, "local");
    await syncOwner(owner);
    expect(clouds.get("one")?.data).toEqual({ ...task, title: "端末での変更" });
    expect(clouds.get("one")?.revision).toBe(3);
  });
  it("does not send another account data when session changed", async () => {
    await saveRecord(owner, "task", task, "one");
    mock.session.mockResolvedValueOnce({
      data: { session: { user: { id: "another-user" } } },
      error: null,
    });
    expect((await syncOwner(owner)).status).toBe("error");
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(await getPendingCount(owner)).toBe(1);
  });
  it("pauses new sync before destructive account operations", async () => {
    await saveRecord(owner, "task", task, "one");
    const { pauseSyncOwner } = await import("./sync");
    const release = await pauseSyncOwner(owner);
    expect((await syncOwner(owner)).status).toBe("error");
    expect(await getPendingCount(owner)).toBe(1);
    release();
    release();
    expect((await syncOwner(owner)).sent).toBe(1);
  });
  it("keeps edits made while an earlier mutation is in flight", async () => {
    await saveRecord(owner, "task", task, "one");
    const server = mock.rpc.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.rpc.mockImplementationOnce(async (...args: unknown[]) => {
      await gate;
      return server(...args);
    });
    const running = syncOwner(owner);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await saveRecord(owner, "task", { ...task, title: "同期中の編集" }, "one");
    release();
    await running;
    expect(await getPendingCount(owner)).toBe(1);
    await syncOwner(owner);
    expect(clouds.get("one")?.data).toEqual({ ...task, title: "同期中の編集" });
  });
  it("quarantines a remote record removed by explicit cloud data deletion", async () => {
    await saveRecord(owner, "task", task, "one");
    await syncOwner(owner);
    clouds.clear();
    await saveRecord(
      owner,
      "task",
      { ...task, title: "端末側に残る変更" },
      "one",
    );
    mock.rpc.mockResolvedValueOnce({
      data: { status: "conflict", record: null },
      error: null,
    });
    expect((await syncOwner(owner)).conflicts).toBe(1);
    const [conflict] = await getConflicts(owner);
    expect(conflict.remote.deleted).toBe(true);
    await resolveConflict(conflict.id, "local");
    await syncOwner(owner);
    expect(clouds.get("one")?.data).toEqual({
      ...task,
      title: "端末側に残る変更",
    });
  });
  it("accepts Postgres timestamps carrying timezone offsets", async () => {
    const { fromCloud } = await import("./sync");
    const row: CloudRow = {
      owner,
      id: "offset",
      kind: "task",
      data: task,
      version: 1,
      revision: 1,
      deleted: false,
      created_at: "2026-11-24T00:00:00+00:00",
      updated_at: "2026-11-24T09:00:00+09:00",
    };
    expect(fromCloud(row).id).toBe("offset");
    clouds.set(row.id, row);
    expect((await syncOwner(owner)).received).toBe(1);
  });
  it("stops an old owner queue after an account switch and pins every sent token", async () => {
    await saveRecord(owner, "task", task, "one");
    await saveRecord(owner, "task", task, "two");
    const server = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await server(...args);
      mock.session.mockResolvedValue({
        data: {
          session: {
            user: { id: "another-user" },
            access_token: "owner-b-test-token",
          },
        },
        error: null,
      });
      return result;
    });
    expect((await syncOwner(owner)).status).toBe("error");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(await getPendingCount(owner)).toBe(1);
    expect(mock.headers.mock.calls.flat()).toEqual([
      "Bearer owner-a-test-token",
    ]);
    expect(await getRecords("another-user")).toHaveLength(0);
  });
  it("persists the deletion guard across reopen and blocks all uploads until cleanup", async () => {
    await saveRecord(owner, "task", task, "one");
    await db.meta.put({
      key: `${owner}:deletionPending`,
      value: new Date().toISOString(),
    });
    db.close();
    await db.open();
    expect((await syncOwner(owner)).status).toBe("error");
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(await getPendingCount(owner)).toBe(1);
    const { clearOwner } = await import("./db");
    await clearOwner(owner);
    expect(await db.meta.get(`${owner}:deletionPending`)).toBeUndefined();
  });
  it("blocks later queued snapshots even if their expected revision matches a conflicting remote edit", async () => {
    await saveRecord(owner, "task", task, "one");
    await syncOwner(owner);
    mock.rpc.mockClear();
    await saveRecord(owner, "task", { ...task, title: "端末変更その1" }, "one");
    await saveRecord(owner, "task", { ...task, title: "端末変更その2" }, "one");
    const row = clouds.get("one")!;
    clouds.set("one", {
      ...row,
      revision: 2,
      data: { ...task, title: "別端末の新しい内容" },
    });
    await syncOwner(owner);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(await getPendingCount(owner)).toBe(2);
    expect(clouds.get("one")?.data).toEqual({
      ...task,
      title: "別端末の新しい内容",
    });
    const [conflict] = await getConflicts(owner);
    expect(conflict.local.data).toEqual({ ...task, title: "端末変更その2" });
    await resolveConflict(conflict.id, "local");
    await syncOwner(owner);
    expect(clouds.get("one")?.data).toEqual({
      ...task,
      title: "端末変更その2",
    });
    expect(await getPendingCount(owner)).toBe(0);
  });
  it("stops subsequent queued mutations if a durable deletion barrier appears mid-run", async () => {
    await saveRecord(owner, "task", task, "one");
    await saveRecord(owner, "task", task, "two");
    const server = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await server(...args);
      await db.meta.put({
        key: `${owner}:deletionPending`,
        value: new Date().toISOString(),
      });
      return result;
    });
    expect((await syncOwner(owner)).status).toBe("error");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(await getPendingCount(owner)).toBe(1);
  });
  it("recovers cloud data into a fresh local namespace", async () => {
    await saveRecord(owner, "task", task, "one");
    await syncOwner(owner);
    const { clearOwner } = await import("./db");
    await clearOwner(owner);
    expect((await syncOwner(owner)).received).toBe(1);
    expect((await getRecords(owner))[0].data).toEqual(task);
  });
});
