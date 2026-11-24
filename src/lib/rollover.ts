import { db, getConflicts, getRecords, saveRecord } from "./db";
import { addDays, addMonths, localDate } from "./dates";
import { ofKind, type RecordOf, type TaskData } from "../types";

/** The local date of the latest configured reset boundary. */
export function resetPeriod(resetTime: string, now = new Date()): string {
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return clock >= resetTime ? localDate(now) : addDays(localDate(now), -1);
}

export function nextTaskDate(task: TaskData, today = localDate()): string {
  const base = task.due && task.due > today ? task.due : today;
  return task.repeat === "monthly"
    ? addMonths(base, 1)
    : addDays(base, task.repeat === "weekly" ? 7 : 1);
}

async function snapshotChecklist(record: RecordOf<"checklist">, now: Date) {
  await saveRecord(record.owner, "checkHistory", {
    checklistId: record.id,
    title: record.data.title,
    date: record.data.lastReset || localDate(now),
    checked: record.data.items.filter((item) => item.checked).length,
    total: record.data.items.length,
    items: record.data.items.map(({ title, checked }) => ({ title, checked })),
  });
}

/** Manual reset preserves a snapshot, including multiple resets on the same day. */
export async function resetChecklist(
  owner: string,
  id: string,
  now = new Date(),
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const record = await db.records.get([owner, id]);
    if (!record || record.deleted || record.kind !== "checklist") return;
    await snapshotChecklist(record, now);
    await saveRecord(
      owner,
      "checklist",
      {
        ...record.data,
        items: record.data.items.map((item) => ({ ...item, checked: false })),
        lastReset: resetPeriod(record.data.resetTime, now),
      },
      id,
    );
  });
}

/** Local startup/foreground catch-up. Closed-app timers are never assumed to run. */
export async function runRollover(
  owner: string,
  now = new Date(),
): Promise<void> {
  await db.transaction("rw", db.records, db.outbox, db.conflicts, async () => {
    const records = await getRecords(owner);
    const blocked = new Set(
      (await getConflicts(owner)).map((conflict) => conflict.recordId),
    );
    for (const record of ofKind(records, "checklist")) {
      if (blocked.has(record.id)) continue;
      const period = resetPeriod(record.data.resetTime, now);
      // A backwards device clock must never reset a newer saved state.
      if (record.data.lastReset && record.data.lastReset >= period) continue;
      if (record.data.lastReset) await snapshotChecklist(record, now);
      await saveRecord(
        owner,
        "checklist",
        {
          ...record.data,
          items: record.data.items.map((item) => ({ ...item, checked: false })),
          lastReset: period,
        },
        record.id,
      );
    }
    const today = localDate(now);
    for (const record of ofKind(records, "task")) {
      if (
        blocked.has(record.id) ||
        record.data.completed ||
        !record.data.due ||
        record.data.due >= today
      )
        continue;
      await saveRecord(
        owner,
        "task",
        { ...record.data, due: today },
        record.id,
      );
    }
  });
}

/** Same occurrence produces the same id across retries and devices. */
async function recurrenceId(sourceId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`life-partner:repeat:${sourceId}`),
    ),
  );
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Completion and its next occurrence are committed together, or neither is saved. */
export async function completeTask(
  owner: string,
  task: RecordOf<"task">,
  completed: boolean,
  today = localDate(),
): Promise<void> {
  if (task.owner !== owner) throw new Error("アカウントが一致しません。");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db.records.get([owner, task.id]);
    if (
      !current ||
      current.deleted ||
      current.kind !== "task" ||
      current.data.completed === completed
    )
      return;
    const due =
      completed && current.data.repeat !== "none"
        ? nextTaskDate(current.data, today)
        : "";
    // Hashing happens before the IDB transaction, so Safari cannot expire it.
    const nextId = due ? await recurrenceId(current.id) : "";
    let retry = false;
    await db.transaction(
      "rw",
      db.records,
      db.outbox,
      db.conflicts,
      async () => {
        const latest = await db.records.get([owner, task.id]);
        if (!latest || latest.deleted || latest.kind !== "task") return;
        if (latest.version !== current.version) {
          retry = true;
          return;
        }
        if (completed) {
          await saveRecord(
            owner,
            "task",
            {
              ...latest.data,
              completed: true,
              completedAt: new Date().toISOString(),
            },
            latest.id,
          );
        } else {
          const { completedAt: _completedAt, ...data } = latest.data;
          await saveRecord(
            owner,
            "task",
            { ...data, completed: false },
            latest.id,
          );
        }
        if (nextId && !(await db.records.get([owner, nextId]))) {
          const { completedAt: _completedAt, ...data } = latest.data;
          await saveRecord(
            owner,
            "task",
            {
              ...data,
              due,
              completed: false,
              steps: data.steps.map((step) => ({ ...step, done: false })),
            },
            nextId,
          );
        }
      },
    );
    if (!retry) return;
  }
  throw new Error("別の画面で変更されました。もう一度操作してください。");
}
