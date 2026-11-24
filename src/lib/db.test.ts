import Dexie from "dexie";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  db,
  saveRecord,
  getRecords,
  deleteRecord,
  restoreRecord,
  getPendingCount,
  LifePartnerDB,
  clearOwner,
} from "./db";
import type { TaskData } from "../types";
const task: TaskData = {
  title: "架空のタスク",
  due: "2026-11-24",
  priority: "normal",
  category: "生活",
  memo: "",
  completed: false,
  repeat: "none",
  steps: [],
};
beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());
describe("durable records and immutable outbox", () => {
  it("retains records and pending changes after close/reopen, isolated by owner", async () => {
    await saveRecord("local", "task", task, "one");
    await saveRecord(
      "user-other",
      "task",
      { ...task, title: "別の利用者" },
      "one",
    );
    db.close();
    await db.open();
    expect((await getRecords("local"))[0].data).toEqual(task);
    expect((await getRecords("user-other"))[0].data).not.toEqual(task);
    expect(await getPendingCount("local")).toBe(1);
  });
  it("stores immutable ordered snapshots and deletion tombstones with undo", async () => {
    await saveRecord("local", "task", task, "one");
    await saveRecord("local", "task", { ...task, title: "変更" }, "one");
    const [record] = await getRecords("local");
    await deleteRecord(record);
    const queue = await db.outbox
      .where("owner")
      .equals("local")
      .sortBy("sequence");
    expect(queue.map((q) => q.expectedRevision)).toEqual([0, 1, 2]);
    expect(queue[0].record.data).toEqual(task);
    expect(queue[2].record.deleted).toBe(true);
    await restoreRecord(record);
    expect((await getRecords("local"))[0].deleted).toBe(false);
    expect(await getPendingCount("local")).toBe(4);
  });
  it("rolls back record write if persistent queue write fails", async () => {
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(
      new DOMException("Quota exceeded", "QuotaExceededError"),
    );
    await expect(saveRecord("local", "task", task, "one")).rejects.toThrow();
    expect(await getRecords("local")).toHaveLength(0);
    expect(await getPendingCount("local")).toBe(0);
  });
  it("rejects invalid integer currency and calendar dates before storage", async () => {
    await expect(
      saveRecord("local", "transaction", {
        type: "expense",
        amount: 1.2,
        category: "架空",
        memo: "",
        date: "2026-11-24",
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord("local", "task", { ...task, due: "2026-02-30" }),
    ).rejects.toThrow();
    expect(await getRecords("local")).toHaveLength(0);
  });
  it("rejects duplicate item identities and malformed fixed-cost periods", async () => {
    await expect(
      saveRecord("local", "checklist", {
        title: "架空",
        resetTime: "04:00",
        lastReset: "2026-11-24",
        items: [
          { id: "same", title: "持ち物1", checked: false },
          { id: "same", title: "持ち物2", checked: false },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord("local", "transaction", {
        type: "expense",
        amount: 100,
        category: "架空",
        memo: "",
        date: "2026-11-24",
        fixedPeriod: "2026-99",
      }),
    ).rejects.toThrow();
    expect(await getPendingCount("local")).toBe(0);
  });
  it("clears only the requested local account namespace", async () => {
    await saveRecord("a", "task", task, "one");
    await saveRecord("b", "task", task, "one");
    await clearOwner("a");
    expect(await getRecords("a")).toHaveLength(0);
    expect(await getRecords("b")).toHaveLength(1);
    expect(await getPendingCount("a")).toBe(0);
    expect(await getPendingCount("b")).toBe(1);
  });
  it("migrates version 1 to 2 without losing old data", async () => {
    const name = "life-partner-migration-test";
    const old = new Dexie(name);
    await old.delete();
    old
      .version(1)
      .stores({
        records: "[owner+id],owner,kind",
        outbox: "mutationId,owner,[owner+id],sequence",
      });
    await old.open();
    await old
      .table("records")
      .put({
        id: "old",
        owner: "local",
        kind: "task",
        data: task,
        version: 1,
        serverRevision: 0,
        deleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    old.close();
    const upgraded = new LifePartnerDB(name);
    await upgraded.open();
    expect((await upgraded.records.get(["local", "old"]))?.data).toEqual(task);
    expect(await upgraded.conflicts.count()).toBe(0);
    await upgraded.delete();
  });
});
