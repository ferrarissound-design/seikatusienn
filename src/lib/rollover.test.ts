import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, getRecords, saveRecord } from "./db";
import {
  completeTask,
  nextTaskDate,
  resetChecklist,
  resetPeriod,
  runRollover,
} from "./rollover";
import { ofKind, type TaskData } from "../types";

beforeEach(async () => {
  await db.records.clear();
  await db.outbox.clear();
  await db.conflicts.clear();
});
const baseTask: TaskData = {
  title: "架空の掃除",
  due: "2026-01-31",
  priority: "normal",
  category: "生活",
  memo: "",
  completed: false,
  repeat: "monthly",
  steps: [{ id: "step", title: "ゴミを集める", done: true }],
};

describe("local reset boundaries", () => {
  it("uses yesterday until the configured hour and handles year boundaries", () => {
    expect(resetPeriod("05:00", new Date(2027, 0, 1, 4, 59))).toBe(
      "2026-12-31",
    );
    expect(resetPeriod("05:00", new Date(2027, 0, 1, 5, 0))).toBe("2027-01-01");
  });
  it("catches up once after several closed days, preserving exact checked history", async () => {
    await saveRecord(
      "local",
      "checklist",
      {
        title: "架空の外出",
        items: [
          { id: "keys", title: "鍵", checked: true },
          { id: "wallet", title: "財布", checked: false },
        ],
        resetTime: "05:00",
        lastReset: "2026-12-29",
      },
      "check",
    );
    await runRollover("local", new Date(2027, 0, 1, 6));
    await runRollover("local", new Date(2027, 0, 1, 7));
    const records = await getRecords("local");
    expect(ofKind(records, "checkHistory")).toHaveLength(1);
    expect(ofKind(records, "checkHistory")[0].data).toMatchObject({
      date: "2026-12-29",
      checked: 1,
      total: 2,
    });
    expect(
      ofKind(records, "checklist")[0].data.items.every((item) => !item.checked),
    ).toBe(true);
    expect(ofKind(records, "checklist")[0].data.lastReset).toBe("2027-01-01");
  });
  it("does not erase checks before reset hour or after a backwards clock change", async () => {
    await saveRecord(
      "local",
      "checklist",
      {
        title: "外出",
        items: [{ id: "key", title: "鍵", checked: true }],
        resetTime: "05:00",
        lastReset: "2026-11-23",
      },
      "check",
    );
    await runRollover("local", new Date(2026, 10, 24, 4));
    await runRollover("local", new Date(2026, 10, 22, 6));
    expect(
      ofKind(await getRecords("local"), "checklist")[0].data.items[0].checked,
    ).toBe(true);
    expect(ofKind(await getRecords("local"), "checkHistory")).toHaveLength(0);
  });
  it("rolls back both snapshot and reset if queue persistence fails", async () => {
    await saveRecord(
      "local",
      "checklist",
      {
        title: "外出",
        items: [{ id: "key", title: "鍵", checked: true }],
        resetTime: "05:00",
        lastReset: "2026-11-24",
      },
      "check",
    );
    const count = await db.outbox.count();
    const originalAdd = db.outbox.add.bind(db.outbox);
    const failure = vi
      .spyOn(db.outbox, "add")
      .mockImplementationOnce(originalAdd)
      .mockRejectedValueOnce(new Error("storage full"));
    try {
      await expect(
        resetChecklist("local", "check", new Date(2026, 10, 24, 10)),
      ).rejects.toThrow("storage full");
    } finally {
      failure.mockRestore();
    }
    expect(ofKind(await getRecords("local"), "checkHistory")).toHaveLength(0);
    expect(
      ofKind(await getRecords("local"), "checklist")[0].data.items[0].checked,
    ).toBe(true);
    expect(await db.outbox.count()).toBe(count);
  });
  it("preserves multiple manual reset snapshots on one day", async () => {
    await saveRecord(
      "local",
      "checklist",
      {
        title: "外出",
        items: [{ id: "key", title: "鍵", checked: true }],
        resetTime: "05:00",
        lastReset: "2026-11-24",
      },
      "check",
    );
    await resetChecklist("local", "check", new Date(2026, 10, 24, 10));
    await resetChecklist("local", "check", new Date(2026, 10, 24, 11));
    expect(ofKind(await getRecords("local"), "checkHistory")).toHaveLength(2);
  });
});

describe("task completion and recurrence", () => {
  it("clamps monthly dates and uses completion date when overdue", () => {
    expect(nextTaskDate(baseTask, "2026-01-31")).toBe("2026-02-28");
    expect(nextTaskDate({ ...baseTask, repeat: "weekly" }, "2026-12-29")).toBe(
      "2027-01-05",
    );
  });
  it("retains completed original and creates one reset next task across undo/retry", async () => {
    await saveRecord("local", "task", baseTask, "task");
    const original = ofKind(await getRecords("local"), "task")[0];
    await completeTask("local", original, true, "2026-01-31");
    await completeTask("local", original, true, "2026-01-31");
    await completeTask("local", original, false, "2026-01-31");
    await completeTask("local", original, true, "2026-01-31");
    await completeTask("local", original, false, "2026-02-02");
    await completeTask("local", original, true, "2026-02-02");
    const tasks = ofKind(await getRecords("local"), "task");
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === "task")?.data.completed).toBe(true);
    expect(tasks.find((t) => t.id !== "task")?.data).toMatchObject({
      due: "2026-02-28",
      completed: false,
      steps: [{ id: "step", title: "ゴミを集める", done: false }],
    });
  });
  it("rolls overdue active tasks forward but preserves completion history", async () => {
    await saveRecord(
      "local",
      "task",
      { ...baseTask, repeat: "none" },
      "active",
    );
    await saveRecord(
      "local",
      "task",
      { ...baseTask, completed: true, completedAt: "2026-01-31T09:00:00.000Z" },
      "done",
    );
    await runRollover("local", new Date(2026, 1, 2, 10));
    const tasks = ofKind(await getRecords("local"), "task");
    expect(tasks.find((t) => t.id === "active")?.data.due).toBe("2026-02-02");
    expect(tasks.find((t) => t.id === "done")?.data.due).toBe("2026-01-31");
  });
  it("keeps owners separate", async () => {
    await saveRecord("other", "task", baseTask, "task");
    const task = ofKind(await getRecords("other"), "task")[0];
    await expect(completeTask("local", task, true)).rejects.toThrow();
    expect(ofKind(await getRecords("other"), "task")[0].data.completed).toBe(
      false,
    );
  });
});
