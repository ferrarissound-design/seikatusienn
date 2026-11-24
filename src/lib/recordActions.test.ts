import { beforeEach, describe, expect, it } from "vitest";
import { db, getRecords, saveRecord } from "./db";
import { ofKind, type TaskData } from "../types";
import {
  postponeTask,
  saveEditedRecord,
  saveRecordVersioned,
  setChecklistItem,
  setTaskStep,
} from "./recordActions";

beforeEach(async () => {
  await db.records.clear();
  await db.outbox.clear();
  await db.conflicts.clear();
});
const task: TaskData = {
  title: "架空の掃除",
  due: "2026-11-24",
  priority: "normal",
  category: "生活",
  memo: "",
  completed: false,
  repeat: "none",
  steps: [
    { id: "one", title: "ゴミを集める", done: false },
    { id: "two", title: "机を整える", done: false },
  ],
};

describe("authoritative UI patches", () => {
  it("retains rapid changes to different checklist items and repeated desired state is idempotent", async () => {
    await saveRecord(
      "local",
      "checklist",
      {
        title: "架空の外出",
        items: [
          { id: "keys", title: "鍵", checked: false },
          { id: "wallet", title: "財布", checked: false },
        ],
        resetTime: "05:00",
        lastReset: "2026-11-24",
      },
      "list",
    );
    await Promise.all([
      setChecklistItem("local", "list", "keys", true),
      setChecklistItem("local", "list", "wallet", true),
      setChecklistItem("local", "list", "keys", true),
    ]);
    expect(
      ofKind(await getRecords("local"), "checklist")[0].data.items.every(
        (item) => item.checked,
      ),
    ).toBe(true);
    expect(await db.outbox.count()).toBe(3);
  });
  it("merges concurrent step completion and postponement without dropping either", async () => {
    await saveRecord("local", "task", task, "task");
    await Promise.all([
      setTaskStep("local", "task", "one", true),
      setTaskStep("local", "task", "two", true),
      postponeTask("local", "task", "2026-11-25"),
    ]);
    const actual = ofKind(await getRecords("local"), "task")[0].data;
    expect(actual.due).toBe("2026-11-25");
    expect(actual.steps.every((step) => step.done)).toBe(true);
  });
  it("rejects a stale long-form save without losing the newer edit", async () => {
    await saveRecord("local", "task", task, "task");
    const snapshot = ofKind(await getRecords("local"), "task")[0];
    await setTaskStep("local", "task", "one", true);
    await expect(
      saveEditedRecord(snapshot, { ...snapshot.data, title: "編集中の名前" }),
    ).rejects.toThrow("別の操作");
    const actual = ofKind(await getRecords("local"), "task")[0].data;
    expect(actual.title).toBe(task.title);
    expect(actual.steps[0].done).toBe(true);
  });
  it("gates separately held form data by version and optional update timestamp", async () => {
    await saveRecord("local", "task", task, "task");
    const snapshot = ofKind(await getRecords("local"), "task")[0];
    await expect(
      saveRecordVersioned(
        "local",
        "task",
        { ...task, title: "変更" },
        "task",
        snapshot.version,
        "2000-01-01T00:00:00.000Z",
      ),
    ).rejects.toThrow("別の操作");
    await saveRecordVersioned(
      "local",
      "task",
      { ...task, title: "変更" },
      "task",
      snapshot.version,
      snapshot.updatedAt,
    );
    await expect(
      saveRecordVersioned("local", "task", task, "task", snapshot.version),
    ).rejects.toThrow("別の操作");
    expect(ofKind(await getRecords("local"), "task")[0].data.title).toBe(
      "変更",
    );
  });
  it("does not resurrect a deleted checklist or access a different owner", async () => {
    await saveRecord("other", "task", task, "task");
    await expect(setTaskStep("local", "task", "one", true)).rejects.toThrow(
      "見つかりません",
    );
    expect(
      ofKind(await getRecords("other"), "task")[0].data.steps[0].done,
    ).toBe(false);
  });
});

it("does not replace settings that arrived while initial setup was open", async () => {
  const { saveNewRecord } = await import("./recordActions");
  const { DEFAULT_SETTINGS } = await import("../types");
  await saveRecord(
    "local",
    "settings",
    { ...DEFAULT_SETTINGS, balance: 9000 },
    "settings",
  );
  await expect(
    saveNewRecord(
      "local",
      "settings",
      { ...DEFAULT_SETTINGS, balance: 100 },
      "settings",
    ),
  ).rejects.toThrow("別の操作");
  expect((await db.records.get(["local", "settings"]))?.data).toMatchObject({
    balance: 9000,
  });
});
