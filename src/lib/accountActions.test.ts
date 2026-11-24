import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCloudScope } from "./accountActions";
import * as storage from "./db";
const owner = "deletion-test-user";
beforeEach(async () => {
  await storage.clearOwner(owner);
  await storage.saveRecord(owner, "transaction", {
    type: "expense",
    amount: 500,
    category: "架空の食費",
    memo: "",
    date: "2026-11-24",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("cloud deletion data safety", () => {
  it("persists a barrier before remote deletion, then clears records, queue and barrier after confirmation", async () => {
    const signOut = vi.fn(async () => {});
    await deleteCloudScope(
      owner,
      async () => {
        expect(
          await storage.db.meta.get(`${owner}:deletionPending`),
        ).toBeDefined();
        expect(await storage.getPendingCount(owner)).toBe(1);
      },
      signOut,
    );
    expect(await storage.getRecords(owner)).toEqual([]);
    expect(await storage.getPendingCount(owner)).toBe(0);
    expect(
      await storage.db.meta.get(`${owner}:deletionPending`),
    ).toBeUndefined();
    expect(signOut).toHaveBeenCalledOnce();
  });
  it("keeps local records and the durable sync barrier when the remote outcome is uncertain", async () => {
    const signOut = vi.fn(async () => {});
    await expect(
      deleteCloudScope(
        owner,
        async () => {
          throw new Error("network lost after request");
        },
        signOut,
      ),
    ).rejects.toThrow("同期を停止");
    expect(await storage.getRecords(owner)).toHaveLength(1);
    expect(await storage.getPendingCount(owner)).toBe(1);
    expect(await storage.db.meta.get(`${owner}:deletionPending`)).toBeDefined();
    expect(signOut).not.toHaveBeenCalled();
  });
  it("still signs out if local cleanup fails after confirmed server deletion", async () => {
    vi.spyOn(storage, "clearOwner").mockRejectedValueOnce(
      new Error("IndexedDB unavailable"),
    );
    const signOut = vi.fn(async () => {});
    await expect(
      deleteCloudScope(owner, async () => {}, signOut),
    ).rejects.toThrow("端末の記録削除");
    expect(signOut).toHaveBeenCalledOnce();
    expect(await storage.db.meta.get(`${owner}:deletionPending`)).toBeDefined();
    expect(await storage.getPendingCount(owner)).toBe(1);
  });
  it("does not delete remotely if the durable barrier cannot be saved", async () => {
    vi.spyOn(storage.db.meta, "put").mockRejectedValueOnce(
      new Error("quota exceeded"),
    );
    const remote = vi.fn(async () => {});
    await expect(
      deleteCloudScope(owner, remote, async () => {}),
    ).rejects.toThrow("quota exceeded");
    expect(remote).not.toHaveBeenCalled();
    expect(await storage.getRecords(owner)).toHaveLength(1);
  });
  it("reports a logout failure accurately after local cleanup succeeds", async () => {
    await expect(
      deleteCloudScope(
        owner,
        async () => {},
        async () => {
          throw new Error("auth network");
        },
      ),
    ).rejects.toThrow("記録は削除しました");
    expect(await storage.getRecords(owner)).toEqual([]);
    expect(await storage.getPendingCount(owner)).toBe(0);
  });
  it("rejects a local namespace before any destructive remote action", async () => {
    const remote = vi.fn(async () => {});
    await expect(
      deleteCloudScope("local", remote, async () => {}),
    ).rejects.toThrow("ログイン");
    expect(remote).not.toHaveBeenCalled();
  });
});
