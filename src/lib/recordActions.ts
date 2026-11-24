import { db, saveRecord } from "./db";
import type {
  ChecklistData,
  DataMap,
  Kind,
  RecordOf,
  TaskData,
} from "../types";

type EditableKind = "task" | "checklist";

/** Merge a small user action into the authoritative IDB record inside one lock. */
async function patch<K extends EditableKind>(
  owner: string,
  id: string,
  kind: K,
  update: (data: DataMap[K]) => DataMap[K],
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const current = await db.records.get([owner, id]);
    if (!current || current.deleted || current.kind !== kind)
      throw new Error("記録が見つかりません。最新の画面を確認してください。");
    const next = update(structuredClone(current.data) as DataMap[K]);
    if (JSON.stringify(next) === JSON.stringify(current.data)) return;
    await saveRecord(owner, kind, next, id);
  });
}

export async function setChecklistItem(
  owner: string,
  checklistId: string,
  itemId: string,
  checked: boolean,
): Promise<void> {
  await patch(owner, checklistId, "checklist", (data: ChecklistData) => {
    if (!data.items.some((item) => item.id === itemId))
      throw new Error(
        "持ち物が変更されました。最新のリストを確認してください。",
      );
    return {
      ...data,
      items: data.items.map((item) =>
        item.id === itemId ? { ...item, checked } : item,
      ),
    };
  });
}

export async function setTaskStep(
  owner: string,
  taskId: string,
  stepId: string,
  done: boolean,
): Promise<void> {
  await patch(owner, taskId, "task", (data: TaskData) => {
    if (!data.steps.some((step) => step.id === stepId))
      throw new Error("作業が変更されました。最新のタスクを確認してください。");
    return {
      ...data,
      steps: data.steps.map((step) =>
        step.id === stepId ? { ...step, done } : step,
      ),
    };
  });
}

export async function postponeTask(
  owner: string,
  taskId: string,
  due: string,
): Promise<void> {
  await patch(owner, taskId, "task", (data: TaskData) => ({ ...data, due }));
}

/** Do not silently overwrite edits received while a long form was open. */
export async function saveEditedRecord<K extends Kind>(
  snapshot: RecordOf<K>,
  data: DataMap[K],
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const current = await db.records.get([snapshot.owner, snapshot.id]);
    if (
      !current ||
      current.deleted ||
      current.kind !== snapshot.kind ||
      current.version !== snapshot.version ||
      current.updatedAt !== snapshot.updatedAt
    ) {
      throw new Error(
        "この記録は別の操作で変更されました。入力は残っています。最新の内容を確認してから編集し直してください。",
      );
    }
    await saveRecord(snapshot.owner, snapshot.kind, data, snapshot.id);
  });
}

/** Version gate for forms that keep their fields separately from their record snapshot. */
export async function saveRecordVersioned<K extends Kind>(
  owner: string,
  kind: K,
  data: DataMap[K],
  id: string,
  expectedVersion: number,
  expectedUpdatedAt?: string,
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const current = await db.records.get([owner, id]);
    if (
      !current ||
      current.deleted ||
      current.kind !== kind ||
      current.version !== expectedVersion ||
      (expectedUpdatedAt !== undefined &&
        current.updatedAt !== expectedUpdatedAt)
    ) {
      throw new Error(
        "この記録は別の操作で変更されました。入力は残っています。最新の内容を確認してから編集し直してください。",
      );
    }
    await saveRecord(owner, kind, data, id);
  });
}

/** Canonical settings may arrive from another tab or cloud while initial setup is open. */
export async function saveNewRecord<K extends Kind>(
  owner: string,
  kind: K,
  data: DataMap[K],
  id: string,
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    if (await db.records.get([owner, id]))
      throw new Error(
        "別の操作で設定が保存されました。最新の設定を確認してから、もう一度入力してください。",
      );
    await saveRecord(owner, kind, data, id);
  });
}
