import { beforeEach, describe, it, expect, vi } from "vitest";
import * as dbModule from "./db";
import {
  db,
  saveRecord,
  getRecords,
  getConflicts,
  resolveConflict,
} from "./db";
import {
  exportBackup,
  parseBackup,
  restoreBackup,
  previewBackup,
  exportTransactionsCSV,
} from "./backup";
import type { TaskData } from "../types";
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
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  await db.open();
});
describe("non-destructive backup restoration", () => {
  it("round trips into another owner, repeated imports are duplicates", async () => {
    await saveRecord("local", "task", task, "one");
    const backup = parseBackup(await exportBackup("local"));
    expect(await previewBackup("new", backup)).toEqual({
      newRecords: 1,
      duplicates: 0,
      conflicts: 0,
    });
    await restoreBackup("new", backup);
    await restoreBackup("new", backup);
    expect(await getRecords("new")).toHaveLength(1);
    expect((await getRecords("new"))[0].owner).toBe("new");
    expect(await previewBackup("new", backup)).toEqual({
      newRecords: 0,
      duplicates: 1,
      conflicts: 0,
    });
  });
  it("quarantines differing records without overwriting, allows explicit resolution", async () => {
    await saveRecord("local", "task", task, "one");
    const backup = parseBackup(await exportBackup("local"));
    await saveRecord("local", "task", { ...task, title: "新しい内容" }, "one");
    expect((await restoreBackup("local", backup)).conflicts).toBe(1);
    expect((await getRecords("local"))[0].data).toEqual({
      ...task,
      title: "新しい内容",
    });
    const [conflict] = await getConflicts("local");
    await expect(saveRecord("local", "task", task, "one")).rejects.toThrow(
      "競合",
    );
    await resolveConflict(conflict.id, "remote");
    expect((await getRecords("local"))[0].data).toEqual(task);
    expect(await getConflicts("local")).toHaveLength(0);
    expect((await db.conflicts.get(conflict.id))?.resolved).toBe(true);
  });
  it("rejects malformed, unknown, duplicate and invalid records without changing storage", async () => {
    await saveRecord("local", "task", task, "one");
    const valid = JSON.parse(await exportBackup("local"));
    expect(() => parseBackup("{")).toThrow();
    expect(() => parseBackup('{"version":2}')).toThrow();
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...valid,
          records: [...valid.records, ...valid.records],
        }),
      ),
    ).toThrow("重複");
    valid.records[0].data.title = "";
    expect(() => parseBackup(JSON.stringify(valid))).toThrow("不正");
    await expect(restoreBackup("local", valid)).rejects.toThrow();
    expect(await getRecords("local")).toHaveLength(1);
  });
  it("includes active and resolved conflict variants in complete backup", async () => {
    await saveRecord("local", "task", task, "one");
    const original = parseBackup(await exportBackup("local"));
    await saveRecord("local", "task", { ...task, title: "変更" }, "one");
    await restoreBackup("local", original);
    const [conflict] = await getConflicts("local");
    await resolveConflict(conflict.id, "local");
    const complete = parseBackup(await exportBackup("local"));
    expect(complete.conflicts).toHaveLength(1);
    await restoreBackup("another-owner", complete);
    await restoreBackup("another-owner", complete);
    const preserved = await db.conflicts
      .where("owner")
      .equals("another-owner")
      .toArray();
    expect(preserved).toHaveLength(1);
    expect(preserved[0].resolved).toBe(true);
    expect(preserved[0].remote.data).toEqual(task);
  });
  it("refuses an export exceeding the restore record limit before offering an unusable file", async () => {
    await saveRecord("local", "task", task, "one");
    const [record] = await getRecords("local");
    vi.spyOn(dbModule, "getRecords").mockResolvedValueOnce(
      Array(50001).fill(record),
    );
    await expect(exportBackup("local")).rejects.toThrow("50,000件");
    expect(await getRecords("local")).toHaveLength(1);
  });
  it("refuses an export exceeding the restore byte limit, counting multibyte Japanese", async () => {
    await saveRecord("local", "task", task, "one");
    const [record] = await getRecords("local");
    vi.spyOn(dbModule, "getRecords").mockResolvedValueOnce([
      {
        ...record,
        kind: "task",
        data: { ...task, memo: "架".repeat(7 * 1024 * 1024) },
      },
    ]);
    await expect(exportBackup("local")).rejects.toThrow("20MB");
    expect(await getRecords("local")).toHaveLength(1);
  });
  it("exports integer-yen CSV with escaping and formula neutralization", async () => {
    await saveRecord(
      "local",
      "transaction",
      {
        type: "expense",
        amount: 100,
        category: "架空",
        memo: '=1+1,"test"',
        date: "2026-11-24",
      },
      "one",
    );
    const csv = await exportTransactionsCSV("local");
    expect(csv).toContain('"100"');
    expect(csv).toContain(`"'=1+1,""test"""`);
    expect(csv[0]).toBe("\uFEFF");
  });
});
