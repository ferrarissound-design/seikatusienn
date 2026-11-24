import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Focus,
  ListTodo,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ofKind, type PageProps, type RecordOf, type TaskData } from "../types";
import { localDate } from "../lib/dates";
import { completeTask } from "../lib/rollover";
import {
  postponeTask,
  saveEditedRecord,
  setTaskStep,
} from "../lib/recordActions";
import "./features.css";

const priorityNames = {
  high: "優先して取り組む",
  normal: "ふつう",
  low: "ゆっくりで大丈夫",
};
const repeatNames = {
  none: "繰り返さない",
  daily: "毎日",
  weekly: "毎週",
  monthly: "毎月",
};
const freshTask = (): TaskData => ({
  title: "",
  due: localDate(),
  priority: "normal",
  category: "生活",
  memo: "",
  completed: false,
  repeat: "none",
  steps: [],
});

export function Tasks({ records, owner, save, remove, notify }: PageProps) {
  const tasks = ofKind(records, "task");
  const [editing, setEditing] = useState<RecordOf<"task"> | null>(null);
  const [form, setForm] = useState<TaskData | null>(null);
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingActions = useRef(0);
  const submitting = useRef(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "history">("active");
  const focusTask = tasks.find((t) => t.id === focusId && !t.data.completed);
  const modalOpen = Boolean(form) || Boolean(focusTask);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[data-tasks-dialog]");
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      );
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!submitting.current) {
          setForm(null);
          setFocusId(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", keyboard);
    return () => {
      dialog.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [modalOpen]);
  const active = tasks
    .filter((t) => !t.data.completed)
    .sort(
      (a, b) =>
        (a.data.due || "9999").localeCompare(b.data.due || "9999") ||
        { high: 0, normal: 1, low: 2 }[a.data.priority] -
          { high: 0, normal: 1, low: 2 }[b.data.priority],
    );
  const done = tasks
    .filter((t) => t.data.completed)
    .sort((a, b) =>
      (b.data.completedAt || b.updatedAt).localeCompare(
        a.data.completedAt || a.updatedAt,
      ),
    );
  const run = async (action: () => Promise<void>, exclusive = false) => {
    if (exclusive && submitting.current) return;
    if (exclusive) submitting.current = true;
    pendingActions.current++;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "保存できませんでした。入力はそのまま残っています。もう一度お試しください。",
      );
    } finally {
      pendingActions.current--;
      setBusy(pendingActions.current > 0);
      if (exclusive) submitting.current = false;
    }
  };
  const edit = (task?: RecordOf<"task">) => {
    setEditing(task || null);
    setForm(task ? structuredClone(task.data) : freshTask());
    setStep("");
  };
  const toggle = (task: RecordOf<"task">) =>
    void run(async () => {
      await completeTask(owner, task, !task.data.completed);
      if (!task.data.completed) {
        notify(
          task.data.repeat === "none"
            ? "記録しました。ひと息ついてくださいね。"
            : "記録して、次の予定も用意しました。",
        );
        setFocusId(null);
      }
    });
  const toggleStep = (task: RecordOf<"task">, id: string, done: boolean) =>
    void run(() => setTaskStep(owner, task.id, id, done));
  const moveStep = (index: number, direction: number) => {
    if (!form) return;
    const target = index + direction;
    if (target < 0 || target >= form.steps.length) return;
    const steps = [...form.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setForm({ ...form, steps });
  };
  const taskCard = (task: RecordOf<"task">, focused = false) => {
    const progress = task.data.steps.filter((s) => s.done).length;
    return (
      <article
        className={`card task-card ${focused ? "focus-card" : ""}`}
        key={task.id}
      >
        <div className="row spread">
          <button
            className={`check-button ${task.data.completed ? "checked" : ""}`}
            disabled={busy}
            aria-label={`${task.data.title}を${task.data.completed ? "未完了に戻す" : "完了にする"}`}
            onClick={() => toggle(task)}
          >
            {task.data.completed ? <Check size={22} /> : <Circle size={22} />}
          </button>
          <div className="task-content" style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ overflowWrap: "anywhere" }}>{task.data.title}</h3>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <span className="chip">
                {task.data.category || "カテゴリーなし"}
              </span>
              <span
                className={`badge ${task.data.priority === "high" ? "warm" : ""}`}
              >
                {priorityNames[task.data.priority]}
              </span>
            </div>
            <p className="muted">
              {task.data.completed
                ? `完了 ${task.data.completedAt ? new Date(task.data.completedAt).toLocaleDateString("ja-JP") : ""}`
                : task.data.due
                  ? `${task.data.due.replaceAll("-", "/")} ${task.data.due < localDate() ? "・今日からまた取り組めます" : ""}`
                  : "期限なし"}
              {task.data.repeat !== "none"
                ? ` ・${repeatNames[task.data.repeat]}`
                : ""}
            </p>
          </div>
          {!focused && (
            <div className="row">
              <button
                className="icon-button"
                aria-label={`${task.data.title}を編集`}
                onClick={() => edit(task)}
              >
                <Pencil size={18} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`${task.data.title}を削除`}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`「${task.data.title}」を削除しますか？`))
                    void run(() => remove(task));
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          )}
        </div>
        {task.data.memo && (
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {task.data.memo}
          </p>
        )}
        {task.data.steps.length > 0 && (
          <div className="stack">
            <div className="row spread">
              <span className="muted">小さな作業</span>
              <span className="muted">
                {progress} / {task.data.steps.length}
              </span>
            </div>
            <progress
              className="progress"
              max={task.data.steps.length}
              value={progress}
              aria-label={`${task.data.title}の進捗`}
            />
            {task.data.steps.map((s) => (
              <label className="list-row" key={s.id}>
                <input
                  type="checkbox"
                  checked={s.done}
                  disabled={busy}
                  onChange={(e) => toggleStep(task, s.id, e.target.checked)}
                />
                <span style={{ overflowWrap: "anywhere" }}>{s.title}</span>
              </label>
            ))}
          </div>
        )}
        {!task.data.completed && !focused && (
          <div className="actions">
            <button className="secondary" onClick={() => setFocusId(task.id)}>
              <Focus size={18} />
              これに集中する
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const date = new Date(`${localDate()}T12:00:00`);
                  date.setDate(date.getDate() + 1);
                  await postponeTask(owner, task.id, localDate(date));
                  notify("明日に繰り越しました。");
                })
              }
            >
              明日に繰り越す
            </button>
          </div>
        )}
        {task.data.completed && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => toggle(task)}
          >
            <RotateCcw size={16} />
            あとで取り組む
          </button>
        )}
      </article>
    );
  };
  return (
    <div className="stack tasks-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ONE STEP AT A TIME</p>
          <h1>やること</h1>
          <p className="muted">小さく分けて、自分のペースで。</p>
        </div>
        <button className="primary" onClick={() => edit()}>
          <Plus size={20} />
          タスクを追加
        </button>
      </div>
      <div className="row" role="group" aria-label="タスクの表示">
        <button
          className={filter === "active" ? "primary" : "secondary"}
          aria-pressed={filter === "active"}
          onClick={() => setFilter("active")}
        >
          これから {active.length}
        </button>
        <button
          className={filter === "history" ? "primary" : "secondary"}
          aria-pressed={filter === "history"}
          onClick={() => setFilter("history")}
        >
          完了履歴 {done.length}
        </button>
      </div>
      {(filter === "active" ? active : done).length === 0 ? (
        <div className="card empty-state">
          <ListTodo size={38} />
          <h2>
            {filter === "active"
              ? "今日はどんな一歩から？"
              : "完了したことを、ここに残します"}
          </h2>
          <p className="muted">
            {filter === "active"
              ? "やることをひとつ登録してみましょう。期限は空欄でも大丈夫です。"
              : "終えたタスクは消さずに、いつでも振り返れます。"}
          </p>
          {filter === "active" && (
            <button className="primary" onClick={() => edit()}>
              最初のタスクを作る
            </button>
          )}
        </div>
      ) : (
        (filter === "active" ? active : done).map((task) => taskCard(task))
      )}
      {focusTask && (
        <div className="modal-overlay" role="presentation">
          <section
            className="modal focus-modal"
            data-tasks-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-heading"
          >
            <div className="row spread">
              <div>
                <p className="eyebrow">FOCUS MODE</p>
                <h2 id="focus-heading">今は、このひとつだけ。</h2>
              </div>
              <button
                className="icon-button"
                aria-label="集中モードを閉じる"
                onClick={() => setFocusId(null)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              途中で休んでも大丈夫。作業はそのまま保存されます。
            </p>
            {taskCard(focusTask, true)}
            <button className="secondary" onClick={() => setFocusId(null)}>
              いったん休む
            </button>
          </section>
        </div>
      )}
      {form && (
        <div className="modal-overlay" role="presentation">
          <section
            className="modal"
            data-tasks-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-form-title"
          >
            <div className="row spread">
              <h2 id="task-form-title">
                {editing ? "タスクを編集" : "タスクを追加"}
              </h2>
              <button
                className="icon-button"
                aria-label="入力を閉じる"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                <X />
              </button>
            </div>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const title = form.title.trim();
                  if (!title) {
                    notify("タスクの名前を入力してください。");
                    return;
                  }
                  const data = {
                    ...form,
                    title,
                    category: form.category.trim(),
                    memo: form.memo.trim(),
                    steps: [
                      ...form.steps.map((item) => ({
                        ...item,
                        title: item.title.trim(),
                      })),
                      ...(step.trim()
                        ? [
                            {
                              id: crypto.randomUUID(),
                              title: step.trim(),
                              done: false,
                            },
                          ]
                        : []),
                    ],
                  };
                  if (editing) await saveEditedRecord(editing, data);
                  else await save("task", data);
                  setForm(null);
                  notify("タスクを保存しました。");
                }, true);
              }}
            >
              <fieldset
                className="stack"
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                <label className="field">
                  タスクの名前
                  <input
                    required
                    maxLength={200}
                    value={form.title}
                    autoFocus
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="例：部屋を整える"
                  />
                </label>
                <div className="grid-two">
                  <label className="field">
                    期限（任意）
                    <input
                      type="date"
                      value={form.due}
                      onChange={(e) =>
                        setForm({ ...form, due: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    優先順位
                    <select
                      value={form.priority}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          priority: e.target.value as TaskData["priority"],
                        })
                      }
                    >
                      {Object.entries(priorityNames).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid-two">
                  <label className="field">
                    カテゴリー
                    <input
                      maxLength={100}
                      value={form.category}
                      onChange={(e) =>
                        setForm({ ...form, category: e.target.value })
                      }
                      placeholder="生活、仕事など"
                    />
                  </label>
                  <label className="field">
                    繰り返し
                    <select
                      value={form.repeat}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          repeat: e.target.value as TaskData["repeat"],
                        })
                      }
                    >
                      {Object.entries(repeatNames).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {form.repeat !== "none" && (
                  <p className="muted">
                    完了すると、完了日または期限の遅い方を基準に次のタスクを作ります。過ぎた回数分をまとめて増やすことはありません。
                  </p>
                )}
                <label className="field">
                  メモ（任意）
                  <textarea
                    maxLength={5000}
                    rows={3}
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  />
                </label>
                <div className="stack">
                  <h3>小さな作業に分ける</h3>
                  {form.steps.map((s, index) => (
                    <div className="row" key={s.id}>
                      <input
                        style={{ minWidth: 0, flex: 1 }}
                        aria-label={`作業 ${index + 1}`}
                        maxLength={200}
                        value={s.title}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            steps: form.steps.map((item) =>
                              item.id === s.id
                                ? { ...item, title: e.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${s.title}を上へ`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${s.title}を下へ`}
                        disabled={index === form.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`${s.title}を取り除く`}
                        onClick={() =>
                          setForm({
                            ...form,
                            steps: form.steps.filter(
                              (item) => item.id !== s.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                  <div className="row">
                    <input
                      style={{ minWidth: 0, flex: 1 }}
                      aria-label="追加する作業"
                      maxLength={200}
                      value={step}
                      placeholder="例：ゴミを集める"
                      onChange={(e) => setStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (step.trim()) {
                            setForm({
                              ...form,
                              steps: [
                                ...form.steps,
                                {
                                  id: crypto.randomUUID(),
                                  title: step.trim(),
                                  done: false,
                                },
                              ],
                            });
                            setStep("");
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={!step.trim()}
                      onClick={() => {
                        if (step.trim()) {
                          setForm({
                            ...form,
                            steps: [
                              ...form.steps,
                              {
                                id: crypto.randomUUID(),
                                title: step.trim(),
                                done: false,
                              },
                            ],
                          });
                          setStep("");
                        }
                      }}
                    >
                      <Plus size={18} />
                      作業を追加
                    </button>
                  </div>
                </div>
                <div className="actions">
                  <button
                    type="submit"
                    className="primary"
                    disabled={
                      busy ||
                      !form.title.trim() ||
                      form.steps.some((s) => !s.title.trim())
                    }
                  >
                    {busy ? "保存しています…" : "保存する"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setForm(null)}
                  >
                    キャンセル
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
