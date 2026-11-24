import { useRef, useState } from "react";
import { saveEditedRecord, saveNewRecord } from "../lib/recordActions";
import { useDialog } from "../lib/useDialog";
import {
  Plus,
  Wallet,
  TrendingUp,
  ReceiptText,
  PiggyBank,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import { ofKind } from "../types";
import type {
  PageProps,
  SettingsData,
  RecordOf,
  TransactionData,
} from "../types";
import { calculateFinance } from "../lib/finance";
import { localDate } from "../lib/dates";
export const yen = (n: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
const categories = ["食費", "コンビニ", "交通費", "趣味", "日用品", "その他"];
export function Money(
  props: PageProps & {
    settings: SettingsData;
    quickAdd?: boolean;
    onQuickDone?: () => void;
  },
) {
  const { records, save, remove, settings, notify } = props;
  const tx = ofKind(records, "transaction"),
    fixed = ofKind(records, "fixedCost");
  const f = calculateFinance(settings, tx, fixed);
  const [form, setForm] = useState<TransactionData | null>(
    props.quickAdd
      ? {
          type: "expense",
          amount: 0,
          category: "食費",
          memo: "",
          date: localDate(),
        }
      : null,
  );
  const [editId, setEditId] = useState<string>();
  const editSnapshot = useRef<RecordOf<"transaction"> | null>(null);
  const costSnapshot = useRef<RecordOf<"fixedCost"> | null>(null);
  const settingsSnapshot = useRef<RecordOf<"settings"> | null>(null);
  const submitLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(localDate().slice(0, 7));
  const [costForm, setCostForm] = useState<{
    title: string;
    amount: number;
    day: number;
    id?: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    RecordOf<"transaction"> | RecordOf<"fixedCost"> | null
  >(null);
  const [budget, setBudget] = useState(false);
  const [draft, setDraft] = useState(settings);
  useDialog(
    Boolean(form || costForm || budget || deleteTarget),
    () => {
      setForm(null);
      setCostForm(null);
      setBudget(false);
      setDeleteTarget(null);
      props.onQuickDone?.();
    },
    busy,
  );
  const reportError = (error: unknown) =>
    notify(
      error instanceof Error
        ? error.message
        : "保存できませんでした。入力を残しています。",
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      submitLock.current ||
      !form ||
      !Number.isSafeInteger(form.amount) ||
      form.amount <= 0
    )
      return;
    submitLock.current = true;
    setBusy(true);
    try {
      if (editSnapshot.current)
        await saveEditedRecord(editSnapshot.current, form);
      else await save("transaction", form);
      setForm(null);
      setEditId(undefined);
      props.onQuickDone?.();
      notify("記録を保存しました");
    } catch (error) {
      reportError(error);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  const filtered = tx
    .filter((t) => t.data.date.startsWith(period))
    .sort(
      (a, b) =>
        b.data.date.localeCompare(a.data.date) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <div className="page stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MONEY</p>
          <h1>お金の見通し</h1>
          <p className="muted">いま使える金額を、ひと目で。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditId(undefined);
            editSnapshot.current = null;
            setForm({
              type: "expense",
              amount: 0,
              category: "食費",
              memo: "",
              date: localDate(),
            });
          }}
        >
          <Plus size={19} />
          記録する
        </button>
      </div>
      <section className="money-hero card">
        <div className="row">
          <span className="round-icon">
            <Wallet size={23} />
          </span>
          <div>
            <span className="eyebrow">今日使える目安</span>
            <p className="allowance">
              {yen(f.dailyAllowance)}
              <small> / 日</small>
            </p>
          </div>
        </div>
        <p>
          次の給料日 {f.nextPayday} まで、今日を含めて {f.daysRemaining} 日
        </p>
        <div className="money-stat-grid">
          <div>
            <span>現在の利用可能残高</span>
            <strong>{yen(f.currentBalance)}</strong>
          </div>
          <div>
            <span>確保する固定費</span>
            <strong>{yen(f.fixedCostsTotal)}</strong>
          </div>
          <div>
            <span>確保する貯金</span>
            <strong>{yen(f.savingsReserved)}</strong>
          </div>
        </div>
        {f.shortage > 0 && (
          <p className="notice">
            確保したい金額まで {yen(f.shortage)}{" "}
            の調整が必要です。固定費や貯金額を見直すこともできます。
          </p>
        )}
        <details>
          <summary>計算の内訳を確認</summary>
          <p>
            （残高 {yen(f.currentBalance)} − 未払い固定費{" "}
            {yen(f.fixedCostsTotal)} − 貯金 {yen(f.savingsReserved)}
            ）と、月間予算の残額の小さい方を {f.daysRemaining}{" "}
            日で割り、円未満を切り捨てています。
          </p>
          <p>
            今月の未払い固定費は、支払日が過ぎても確保します。給料日は次の期間の初日です。給料日当日は翌月の給料日までで計算します。未入金の収入は含みません。固定費の「支払う」で登録した支出は二重に確保しません。
          </p>
          <p>
            月間予算0円は未設定として扱います。将来の予定変更などは反映されないため、登録情報に基づく目安です。
          </p>
        </details>
      </section>
      <div className="grid-two">
        <section className="card stack">
          <div className="section-heading">
            <h2>
              <TrendingUp size={20} />
              今月の予算
            </h2>
            <button
              className="text-button"
              onClick={() => {
                setDraft(settings);
                settingsSnapshot.current =
                  ofKind(records, "settings")[0] ?? null;
                setBudget(true);
              }}
            >
              設定
            </button>
          </div>
          <div className="row spread">
            <span>
              使用済み <strong>{yen(f.monthSpent)}</strong>
            </span>
            <span className="muted">
              {settings.monthlyBudget
                ? `予算 ${yen(settings.monthlyBudget)}`
                : "予算は未設定"}
            </span>
          </div>
          <progress
            className="progress"
            max={100}
            value={Math.min(100, f.budgetUsage)}
          />
          <p>
            残り{" "}
            <strong>
              {settings.monthlyBudget ? yen(f.monthlyRemaining ?? 0) : "—"}
            </strong>
          </p>
          {f.budgetExceeded > 0 && (
            <p className="notice">
              予算から {yen(f.budgetExceeded)}{" "}
              調整すると、次の見通しを立てやすくなります。
            </p>
          )}
          <div className="category-summary">
            {Object.entries(f.categoryTotals).map(([name, amount]) => (
              <div className="row spread" key={name}>
                <span>{name}</span>
                <strong>{yen(amount as number)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="card stack">
          <div className="section-heading">
            <h2>
              <PiggyBank size={20} />
              固定費と貯金
            </h2>
            <button
              className="text-button"
              onClick={() => {
                costSnapshot.current = null;
                setCostForm({ title: "", amount: 0, day: 1 });
              }}
            >
              固定費を追加
            </button>
          </div>
          <p className="muted">
            貯金目標：{settings.savingsTitle} · {yen(settings.savings)}
          </p>
          {fixed.length === 0 ? (
            <p className="empty-text">
              家賃や通信費など、先に確保したい支払いを登録できます。
            </p>
          ) : (
            fixed.map((c) => (
              <div className="list-row" key={c.id}>
                <div className="grow">
                  <strong>{c.data.title}</strong>
                  <small>
                    毎月 {c.data.day} 日 · {yen(c.data.amount)}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label={`${c.data.title}を編集`}
                  onClick={() => {
                    costSnapshot.current = c;
                    setCostForm({ ...c.data, id: c.id });
                  }}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${c.data.title}を削除`}
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
          {f.upcomingFixedCosts.map((c) => (
            <div className="payment-row" key={`${c.id}-${c.period}`}>
              <span>
                {c.date} · {c.title}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await save(
                      "transaction",
                      {
                        type: "expense",
                        amount: c.amount,
                        category: "固定費",
                        memo: c.title,
                        date: localDate(),
                        fixedCostId: c.id,
                        fixedPeriod: c.period,
                      },
                      `fixed-payment:${c.id}:${c.period}`,
                    );
                    notify("支払いを記録しました");
                  } catch (error) {
                    reportError(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Check size={16} />
                支払う {yen(c.amount)}
              </button>
            </div>
          ))}
        </section>
      </div>
      <section className="card stack">
        <div className="section-heading">
          <h2>
            <ReceiptText size={20} />
            記録
          </h2>
          <label className="month-picker">
            <span className="sr-only">表示月</span>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <ReceiptText size={32} />
            <h3>この月の記録はまだありません</h3>
            <p>金額とカテゴリーだけで、さっと記録できます。</p>
          </div>
        ) : (
          filtered.map((t) => (
            <div className="list-row" key={t.id}>
              <span
                className={`transaction-icon ${t.data.type === "income" ? "income" : ""}`}
              >
                {t.data.type === "income" ? "+" : "−"}
              </span>
              <div className="grow">
                <strong>{t.data.category}</strong>
                <small>
                  {t.data.date}
                  {t.data.memo ? ` · ${t.data.memo}` : ""}
                  {t.data.date > localDate() ? " · 予定（残高には未反映）" : ""}
                </small>
              </div>
              <strong className={t.data.type === "income" ? "income-text" : ""}>
                {t.data.type === "income" ? "+" : "−"}
                {yen(t.data.amount)}
              </strong>
              <button
                className="icon-button"
                aria-label="記録を編集"
                onClick={() => {
                  setEditId(t.id);
                  editSnapshot.current = t;
                  setForm(t.data);
                }}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="記録を削除"
                onClick={() => setDeleteTarget(t)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))
        )}
      </section>
      <details className="card">
        <summary>月別の集計</summary>
        <div className="stack">
          {Object.entries(f.monthlyTotals).map(([month, totals]) => (
            <div className="row spread" key={month}>
              <strong>{month}</strong>
              <span>
                収入{" "}
                {yen((totals as { income: number; expense: number }).income)} ／
                支出{" "}
                {yen((totals as { income: number; expense: number }).expense)}
              </span>
            </div>
          ))}
        </div>
      </details>
      {form && (
        <div className="modal-overlay">
          <section
            className="modal"
            data-money-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="tx-title"
          >
            <form onSubmit={submit} className="stack">
              <fieldset className="stack" disabled={busy}>
                <div className="section-heading">
                  <h2 id="tx-title">{editId ? "記録を編集" : "お金を記録"}</h2>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setForm(null);
                      props.onQuickDone?.();
                    }}
                  >
                    閉じる
                  </button>
                </div>
                <div className="segmented">
                  {(["expense", "income"] as const).map((type) => (
                    <button
                      type="button"
                      key={type}
                      className={form.type === type ? "selected" : ""}
                      onClick={() =>
                        setForm({
                          ...form,
                          type,
                          category: type === "income" ? "給与" : "食費",
                        })
                      }
                    >
                      {type === "expense" ? "支出" : "収入"}
                    </button>
                  ))}
                </div>
                <label className="field">
                  金額（円）
                  <input
                    autoFocus
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="999999999999"
                    step="1"
                    required
                    value={form.amount || ""}
                    onChange={(e) =>
                      setForm({ ...form, amount: Number(e.target.value) })
                    }
                  />
                </label>
                <fieldset>
                  <legend>カテゴリー</legend>
                  <div className="category-buttons">
                    {(form.type === "expense"
                      ? categories
                      : ["給与", "臨時収入", "その他"]
                    ).map((c) => (
                      <button
                        type="button"
                        key={c}
                        className={`category-button ${form.category === c ? "selected" : ""}`}
                        onClick={() => setForm({ ...form, category: c })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="field">
                  日付
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                <label className="field">
                  メモ（任意）
                  <input
                    maxLength={1000}
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  {busy ? "保存中…" : "保存する"}
                </button>
              </fieldset>
            </form>
          </section>
        </div>
      )}
      {costForm && (
        <div className="modal-overlay">
          <section
            className="modal"
            data-money-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="cost-title"
          >
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (submitLock.current) return;
                submitLock.current = true;
                setBusy(true);
                try {
                  const data = {
                    title: costForm.title.trim(),
                    amount: costForm.amount,
                    day: costForm.day,
                  };
                  if (costSnapshot.current)
                    await saveEditedRecord(costSnapshot.current, data);
                  else await save("fixedCost", data);
                  setCostForm(null);
                } catch (error) {
                  reportError(error);
                } finally {
                  submitLock.current = false;
                  setBusy(false);
                }
              }}
            >
              <h2 id="cost-title">固定費の設定</h2>
              <label className="field">
                名前
                <input
                  required
                  maxLength={100}
                  value={costForm.title}
                  onChange={(e) =>
                    setCostForm({ ...costForm, title: e.target.value })
                  }
                />
              </label>
              <label className="field">
                金額（円）
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="999999999999"
                  step="1"
                  required
                  value={costForm.amount || ""}
                  onChange={(e) =>
                    setCostForm({ ...costForm, amount: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                支払日（毎月）
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="31"
                  required
                  value={costForm.day}
                  onChange={(e) =>
                    setCostForm({ ...costForm, day: Number(e.target.value) })
                  }
                />
              </label>
              <p className="muted">
                31日などがない月は、その月の末日として計算します。
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCostForm(null)}
                >
                  キャンセル
                </button>
                <button className="primary" disabled={busy}>
                  保存
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {budget && (
        <div className="modal-overlay">
          <section
            className="modal"
            data-money-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-title"
          >
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (submitLock.current) return;
                submitLock.current = true;
                setBusy(true);
                try {
                  if (settingsSnapshot.current)
                    await saveEditedRecord(settingsSnapshot.current, draft);
                  else
                    await saveNewRecord(
                      props.owner,
                      "settings",
                      draft,
                      "settings",
                    );
                  setBudget(false);
                } catch (error) {
                  reportError(error);
                } finally {
                  submitLock.current = false;
                  setBusy(false);
                }
              }}
            >
              <h2 id="budget-title">予算・残高の設定</h2>
              <label className="field">
                基準残高（基準日の記録前・円）
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  max="999999999999"
                  required
                  value={draft.balance}
                  onChange={(e) =>
                    setDraft({ ...draft, balance: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                残高の基準日
                <input
                  type="date"
                  required
                  value={draft.balanceDate}
                  onChange={(e) =>
                    setDraft({ ...draft, balanceDate: e.target.value })
                  }
                />
              </label>
              <p className="muted">
                基準日以降の収入・支出を加減します。基準日の記録を含める前の残高を入力してください。
              </p>
              {(
                [
                  ["monthlyBudget", "月間予算（0円で未設定）"],
                  ["payday", "給料日（毎月1〜31日）"],
                  ["savings", "確保したい貯金額"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    required
                    min={key === "payday" ? 1 : 0}
                    max={key === "payday" ? 31 : 999999999999}
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <label className="field">
                貯金目標の名前
                <input
                  maxLength={100}
                  value={draft.savingsTitle}
                  onChange={(e) =>
                    setDraft({ ...draft, savingsTitle: e.target.value })
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setBudget(false)}
                >
                  キャンセル
                </button>
                <button className="primary">保存</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="modal-overlay">
          <section
            className="modal stack"
            data-money-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-money"
          >
            <h2 id="delete-money">この記録を削除しますか？</h2>
            <p>削除後、表示される「元に戻す」から取り消せます。</p>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => setDeleteTarget(null)}
              >
                残す
              </button>
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await remove(deleteTarget);
                    setDeleteTarget(null);
                  } catch (error) {
                    reportError(error);
                  }
                }}
              >
                削除する
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
