import { useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  ClipboardCheck,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  ofKind,
  type ChecklistData,
  type PageProps,
  type RecordOf,
} from "../types";
import { resetChecklist, resetPeriod } from "../lib/rollover";
import { saveEditedRecord, setChecklistItem } from "../lib/recordActions";
import "./features.css";

const TEMPLATES: { title: string; items: string[] }[] = [
  {
    title: "仕事",
    items: ["スマートフォン", "財布", "鍵", "社員証", "仕事のかばん"],
  },
  {
    title: "学校",
    items: ["スマートフォン", "財布", "鍵", "学生証", "教科書・ノート"],
  },
  {
    title: "買い物",
    items: ["財布", "スマートフォン", "買い物メモ", "エコバッグ"],
  },
  {
    title: "通院",
    items: [
      "診察券",
      "保険証・マイナンバーカード",
      "お薬手帳",
      "財布",
      "予約の確認",
    ],
  },
  {
    title: "旅行",
    items: [
      "財布",
      "スマートフォン",
      "充電器",
      "着替え",
      "いつもの薬",
      "予約・チケット",
    ],
  },
  { title: "日常の外出", items: ["スマートフォン", "財布", "鍵", "ハンカチ"] },
];
const freshDraft = (): ChecklistData => ({
  title: "",
  items: [],
  resetTime: "05:00",
  lastReset: resetPeriod("05:00"),
});

export function Checklists({
  records,
  owner,
  save,
  remove,
  notify,
}: PageProps) {
  const lists = ofKind(records, "checklist");
  const histories = ofKind(records, "checkHistory").sort(
    (a, b) =>
      b.data.date.localeCompare(a.data.date) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const [editingSnapshot, setEditingSnapshot] =
    useState<RecordOf<"checklist"> | null>(null);
  const editingId = editingSnapshot?.id ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ChecklistData>(freshDraft);
  const [itemText, setItemText] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingActions = useRef(0);
  const submitting = useRef(false);
  const begin = () => {
    pendingActions.current++;
    setBusy(true);
  };
  const finish = () => {
    pendingActions.current--;
    setBusy(pendingActions.current > 0);
  };
  const [showHistory, setShowHistory] = useState(false);
  const [historyScope, setHistoryScope] = useState<"selected" | "all">(
    "selected",
  );
  const selected = lists.find((l) => l.id === selectedId) ?? lists[0];

  function startNew(template?: (typeof TEMPLATES)[number]) {
    if (submitting.current) return;
    setEditingSnapshot(null);
    setDraft(
      template
        ? {
            ...freshDraft(),
            title: template.title,
            items: template.items.map((title) => ({
              id: crypto.randomUUID(),
              title,
              checked: false,
            })),
          }
        : freshDraft(),
    );
    setItemText("");
    setIsEditing(true);
  }
  function startEdit(list: RecordOf<"checklist">) {
    if (submitting.current) return;
    setEditingSnapshot(structuredClone(list));
    setDraft({
      ...list.data,
      items: list.data.items.map((item) => ({ ...item })),
    });
    setItemText("");
    setIsEditing(true);
  }
  function addItem() {
    const title = itemText.trim();
    if (!title) return;
    setDraft((d) => ({
      ...d,
      items: [...d.items, { id: crypto.randomUUID(), title, checked: false }],
    }));
    setItemText("");
  }
  function moveItem(index: number, direction: -1 | 1) {
    setDraft((d) => {
      const items = [...d.items];
      [items[index], items[index + direction]] = [
        items[index + direction],
        items[index],
      ];
      return { ...d, items };
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const pendingTitle = itemText.trim();
    const data: ChecklistData = {
      ...draft,
      title: draft.title.trim(),
      items: [
        ...draft.items,
        ...(pendingTitle
          ? [{ id: crypto.randomUUID(), title: pendingTitle, checked: false }]
          : []),
      ]
        .map((item) => ({ ...item, title: item.title.trim() }))
        .filter((item) => item.title),
    };
    if (!data.title) {
      notify("リストの名前を入力してください。");
      return;
    }
    if (!data.items.length) {
      notify("持ち物を1つ追加してください。");
      return;
    }
    submitting.current = true;
    begin();
    try {
      const targetId = editingSnapshot?.id ?? crypto.randomUUID();
      if (editingSnapshot) await saveEditedRecord(editingSnapshot, data);
      else await save("checklist", data, targetId);
      setSelectedId(targetId);
      setIsEditing(false);
      notify("チェックリストを保存しました。");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "保存できませんでした。入力内容はこの画面に残っています。",
      );
    } finally {
      submitting.current = false;
      finish();
    }
  }
  async function toggle(
    list: RecordOf<"checklist">,
    id: string,
    checked: boolean,
  ) {
    begin();
    try {
      await setChecklistItem(owner, list.id, id, checked);
    } catch {
      notify("チェックを保存できませんでした。もう一度お試しください。");
    } finally {
      finish();
    }
  }
  async function deleteList(list: RecordOf<"checklist">) {
    if (
      !window.confirm(
        `「${list.data.title}」を削除しますか？ 過去のチェック履歴は残ります。`,
      )
    )
      return;
    begin();
    try {
      await remove(list);
      setSelectedId("");
    } catch {
      notify("削除できませんでした。もう一度お試しください。");
    } finally {
      finish();
    }
  }
  async function resetList(list: RecordOf<"checklist">) {
    if (
      !window.confirm(
        `「${list.data.title}」のチェックをリセットしますか？ 現在の確認状況は履歴に残ります。`,
      )
    )
      return;
    begin();
    try {
      await resetChecklist(owner, list.id);
      notify("履歴を保存して、チェックをリセットしました。");
    } catch {
      notify("リセットできませんでした。現在のチェックはそのままです。");
    } finally {
      finish();
    }
  }
  const checked =
    selected?.data.items.filter((item) => item.checked).length ?? 0;
  const total = selected?.data.items.length ?? 0;
  const allDone = total > 0 && checked === total;
  const selectedHistory =
    selected && historyScope === "selected"
      ? histories.filter((h) => h.data.checklistId === selected.id)
      : histories;

  return (
    <div className="stack checklists-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CHECKLIST</p>
          <h1>忘れ物チェック</h1>
          <p className="muted">出かける前に、ひとつずつ。</p>
        </div>
        <button className="primary" onClick={() => startNew()}>
          <Plus size={18} />
          リストを作る
        </button>
      </div>
      {isEditing && (
        <section className="card" aria-labelledby="checklist-edit-heading">
          <div className="row spread">
            <h2 id="checklist-edit-heading">
              {editingId ? "リストを編集" : "新しいリスト"}
            </h2>
            <button
              className="icon-button"
              aria-label="編集を閉じる"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "編集を閉じますか？ 保存していない変更は反映されません。",
                  )
                )
                  setIsEditing(false);
              }}
            >
              <X size={20} />
            </button>
          </div>
          <form className="stack" onSubmit={submit}>
            <fieldset
              className="stack"
              disabled={busy}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <label className="field">
                リストの名前
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder="例：いつもの外出"
                />
              </label>
              <div className="stack" aria-label="持ち物の編集">
                {draft.items.map((item, index) => (
                  <div className="row" key={item.id}>
                    <input
                      aria-label={`持ち物 ${index + 1}`}
                      maxLength={100}
                      required
                      value={item.title}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          items: d.items.map((v) =>
                            v.id === item.id
                              ? { ...v, title: e.target.value }
                              : v,
                          ),
                        }))
                      }
                      style={{ minWidth: 0, flex: 1 }}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === 0}
                      aria-label={`${item.title}を上に移動`}
                      onClick={() => moveItem(index, -1)}
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === draft.items.length - 1}
                      aria-label={`${item.title}を下に移動`}
                      onClick={() => moveItem(index, 1)}
                    >
                      <ArrowDown size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`${item.title}をリストから外す`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          items: d.items.filter((v) => v.id !== item.id),
                        }))
                      }
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="row">
                <input
                  aria-label="追加する持ち物"
                  maxLength={100}
                  value={itemText}
                  onChange={(e) => setItemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addItem();
                    }
                  }}
                  placeholder="持ち物を入力"
                  style={{ minWidth: 0, flex: 1 }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={addItem}
                  disabled={!itemText.trim()}
                >
                  <Plus size={18} />
                  追加
                </button>
              </div>
              <label className="field">
                毎日のリセット時刻
                <input
                  type="time"
                  required
                  value={draft.resetTime}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      resetTime: e.target.value,
                      lastReset: resetPeriod(e.target.value),
                    })
                  }
                />
                <span className="muted">
                  アプリを閉じている間のリセットは、次に開いたときに行います。履歴は残ります。
                </span>
              </label>
              <div className="actions">
                <button type="submit" className="primary" disabled={busy}>
                  <Check size={18} />
                  {busy ? "保存しています…" : "リストを保存"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setIsEditing(false)}
                >
                  キャンセル
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      {lists.length === 0 && !isEditing && (
        <section className="card empty-state">
          <ClipboardCheck size={38} />
          <h2>持ち物を覚える役目を、ここに。</h2>
          <p className="muted">
            よく使う場面から選ぶと、すぐにリストを作れます。項目は自由に変えられます。
          </p>
        </section>
      )}
      <section className="card">
        <h2>場面に合わせて作る</h2>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {TEMPLATES.map((template) => (
            <button
              className="chip"
              key={template.title}
              onClick={() => startNew(template)}
            >
              {template.title}
            </button>
          ))}
          <button className="chip" onClick={() => startNew()}>
            <Plus size={16} />
            自分で作る
          </button>
        </div>
      </section>
      {lists.length > 0 && (
        <>
          <div
            className="row"
            style={{ flexWrap: "wrap", gap: 8 }}
            aria-label="チェックリストを選択"
          >
            {lists.map((list) => (
              <button
                key={list.id}
                className={`chip ${selected?.id === list.id ? "active" : ""}`}
                aria-pressed={selected?.id === list.id}
                onClick={() => setSelectedId(list.id)}
              >
                {list.data.title}
                <span className="badge">
                  {list.data.items.filter((i) => i.checked).length}/
                  {list.data.items.length}
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <section
              className="card"
              aria-labelledby="active-checklist-heading"
            >
              <div className="row spread">
                <div>
                  <h2 id="active-checklist-heading">{selected.data.title}</h2>
                  <p className="muted">
                    {checked} / {total} 個を確認済み · 毎日{" "}
                    {selected.data.resetTime} にリセット
                  </p>
                </div>
                <div className="row">
                  <button
                    className="icon-button"
                    aria-label={`${selected.data.title}を編集`}
                    onClick={() => startEdit(selected)}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`${selected.data.title}を削除`}
                    disabled={busy}
                    onClick={() => void deleteList(selected)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <progress
                className="progress"
                max={total || 1}
                value={checked}
                aria-label="持ち物の確認状況"
              />
              <div className="stack" style={{ gap: 4, marginTop: 16 }}>
                {selected.data.items.map((item) => (
                  <button
                    key={item.id}
                    className={`list-row checklist-toggle ${item.checked ? "is-complete" : ""}`}
                    role="checkbox"
                    aria-checked={item.checked}
                    disabled={busy}
                    onClick={() =>
                      void toggle(selected, item.id, !item.checked)
                    }
                  >
                    <span className="check-icon" aria-hidden="true">
                      {item.checked ? <Check size={20} /> : <span />}
                    </span>
                    <span>{item.title}</span>
                    {item.checked && (
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        確認済み
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                className="secondary"
                style={{ marginTop: 16 }}
                disabled={busy}
                onClick={() => void resetList(selected)}
              >
                <RotateCcw size={18} />
                履歴を残してリセット
              </button>
              {allDone && (
                <div className="row" role="status" style={{ marginTop: 16 }}>
                  <CheckCheck size={22} />
                  <p>ひと通り確認できました。いってらっしゃい。</p>
                </div>
              )}
            </section>
          )}
        </>
      )}
      <section className="card">
        <button
          className="row secondary"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          <History size={18} />
          {selected && historyScope === "selected"
            ? `「${selected.data.title}」の`
            : "すべての"}
          チェック履歴<span className="badge">{selectedHistory.length}</span>
        </button>
        {showHistory && (
          <div className="stack" style={{ marginTop: 16 }}>
            {selected && (
              <div className="row" role="group" aria-label="履歴の表示範囲">
                <button
                  className="chip"
                  aria-pressed={historyScope === "selected"}
                  onClick={() => setHistoryScope("selected")}
                >
                  このリスト
                </button>
                <button
                  className="chip"
                  aria-pressed={historyScope === "all"}
                  onClick={() => setHistoryScope("all")}
                >
                  すべての履歴
                </button>
              </div>
            )}
            <p className="muted">
              リセット時に直前の確認状況を保存します。アプリを使わなかった日の履歴は追加しません。
            </p>
            {selectedHistory.length === 0 ? (
              <p className="muted">
                まだ履歴はありません。今日のチェックは保存されています。
              </p>
            ) : (
              selectedHistory.slice(0, 60).map((h) => (
                <details key={h.id}>
                  <summary>
                    {h.data.date} · {h.data.title} · {h.data.checked}/
                    {h.data.total} 個
                  </summary>
                  <ul>
                    {h.data.items.map((item, index) => (
                      <li key={index}>
                        {item.checked ? "✓ 確認済み" : "○ 未確認"} ·{" "}
                        {item.title}
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
            {selectedHistory.length > 60 && (
              <p className="muted">
                最近の60件を表示しています。全履歴はJSONバックアップに含まれます。
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
