import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Cloud,
  Download,
  Upload,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Database,
  Trash2,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  ofKind,
  type PageProps,
  type SettingsData,
  type ReminderData,
  type AnyRecord,
} from "../types";
import {
  clearOwner,
  getConflicts,
  resolveConflict,
  type Conflict,
} from "../lib/db";
import { supabase } from "../lib/sync";
import { deleteCloudScope } from "../lib/accountActions";
import {
  exportBackup,
  parseBackup,
  previewBackup,
  restoreBackup,
  exportTransactionsCSV,
} from "../lib/backup";

export interface SettingsProps extends PageProps {
  settings: SettingsData;
  userEmail?: string;
  syncNow: () => Promise<void>;
  lastSync?: string;
  pending: number;
  passwordRecovery?: boolean;
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function describe(record: AnyRecord) {
  if (record.kind === "transaction")
    return `${record.data.date} / ${record.data.type === "expense" ? "支出" : "収入"} ${record.data.amount.toLocaleString("ja-JP")}円 / ${record.data.category}${record.deleted ? "（削除）" : ""}`;
  if ("title" in record.data)
    return `${record.data.title}${record.deleted ? "（削除）" : ""}`;
  return `${record.kind} / 更新 ${new Date(record.updatedAt).toLocaleString("ja-JP")}`;
}
function userError(error: unknown): string {
  if (!(error instanceof Error))
    return "操作を完了できませんでした。記録は保持しています。";
  if (error.name === "ZodError")
    return "入力内容を確認してください。金額は円単位の整数、日付と時刻は指定の形式で入力してください。";
  if (error.name === "QuotaExceededError" || /quota/i.test(error.message))
    return "端末の保存領域が不足しています。必要な記録をバックアップし、空き容量を確認してください。";
  if (/invalid login credentials/i.test(error.message))
    return "メールアドレスとパスワードを確認してください。";
  if (/email not confirmed/i.test(error.message))
    return "登録確認メールのリンクを開いてからログインしてください。";
  if (/user already registered/i.test(error.message))
    return "このメールアドレスは登録済みです。ログインまたはパスワード再設定をご利用ください。";
  if (/rate limit|too many requests|for security purposes/i.test(error.message))
    return "しばらく時間をおいてから再試行してください。端末の記録は保持しています。";
  if (/fetch|network|connection/i.test(error.message))
    return "通信を確認できませんでした。接続が戻ってから再試行してください。端末の記録は保持しています。";
  return /[ぁ-んァ-ヶ一-龠]/.test(error.message)
    ? error.message
    : "操作を完了できませんでした。入力内容と通信状態を確認して再試行してください。";
}
export function Settings(props: SettingsProps) {
  const {
    settings,
    records,
    owner,
    save,
    remove,
    notify,
    userEmail,
    syncNow,
    lastSync,
    pending,
    passwordRecovery = false,
  } = props;
  const [recoveryOpen, setRecoveryOpen] = useState(passwordRecovery);
  const [conflictError, setConflictError] = useState("");
  const [draft, setDraft] = useState(settings);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [restoreText, setRestoreText] = useState("");
  const [restorePreview, setRestorePreview] = useState<string>("");
  const [reminder, setReminder] = useState<ReminderData>({
    title: "",
    date: "",
    time: "09:00",
    enabled: true,
    type: "checklist",
  });
  const [deleteMode, setDeleteMode] = useState<
    "local" | "cloud" | "account" | null
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const [storage, setStorage] = useState("");
  const [notification, setNotification] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (passwordRecovery) setRecoveryOpen(true);
  }, [passwordRecovery]);
  useEffect(() => {
    setRestoreText("");
    setRestorePreview("");
    setDeleteMode(null);
    setDeleteConfirm("");
    setPassword("");
    setConflicts([]);
    setConflictError("");
  }, [owner]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void getConflicts(owner)
        .then((v) => {
          if (alive) {
            setConflicts(v);
            setConflictError("");
          }
        })
        .catch(() => {
          if (alive)
            setConflictError(
              "競合記録を読み込めませんでした。空き容量とSafariの保存設定を確認してください。",
            );
        });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [owner]);
  useEffect(() => {
    if (!deleteMode) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [deleteMode]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(userError(error));
    } finally {
      setBusy(false);
    }
  };
  const settingsId = ofKind(records, "settings")[0]?.id ?? "settings";
  const savePreferences = () =>
    run(async () => {
      await save("settings", draft, settingsId);
      notify("設定を保存しました");
    });
  const auth = (mode: "login" | "signup" | "reset") =>
    run(async () => {
      if (!supabase)
        throw new Error(
          "クラウド接続が未設定です。ローカルモードはそのまま利用できます。",
        );
      if (!email.trim()) throw new Error("メールアドレスを入力してください");
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: window.location.origin },
        );
        if (error) throw error;
        notify("再設定の案内をメールで送信しました");
        return;
      }
      if (password.length < 8)
        throw new Error("パスワードは8文字以上で入力してください");
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: { emailRedirectTo: window.location.origin },
            });
      if (result.error) throw result.error;
      setPassword("");
      notify(
        mode === "signup"
          ? "登録を受け付けました。確認メールが届いた場合はリンクを開いてください。"
          : "ログインしました",
      );
    });
  const backup = () =>
    run(async () => {
      const text = await exportBackup(owner);
      download(
        typeof text === "string" ? text : JSON.stringify(text, null, 2),
        `life-partner-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      await save(
        "settings",
        { ...settings, lastBackup: new Date().toISOString() },
        settingsId,
      );
      notify(
        "バックアップを作成しました。iPhoneでは「ファイル」に保存してください。",
      );
    });
  const loadBackup = async (file: File) =>
    run(async () => {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("バックアップは20MB以下のファイルを選んでください");
      const text = await file.text();
      const parsed = parseBackup(text);
      const preview = await previewBackup(owner, parsed);
      setRestoreText(text);
      setRestorePreview(
        `新しく取り込む記録：${preview.newRecords}件\n同じ内容の記録：${preview.duplicates}件\n確認が必要な記録：${preview.conflicts}件`,
      );
    });
  const restore = () =>
    run(async () => {
      if (!restoreText) return;
      await restoreBackup(owner, parseBackup(restoreText));
      setRestoreText("");
      setRestorePreview("");
      notify(
        "バックアップを取り込みました。競合がある場合は下の確認欄から選べます。",
      );
    });
  const deleteData = () =>
    run(async () => {
      if (deleteConfirm !== "削除")
        throw new Error("確認欄に「削除」と入力してください");
      if (deleteMode === "account" || deleteMode === "cloud") {
        if (!supabase || !userEmail) throw new Error("ログインが必要です");
        const client = supabase;
        const { data: authData, error: authError } =
          await client.auth.getSession();
        if (authError || authData.session?.user.id !== owner)
          throw new Error(
            "ログイン状態が変わりました。削除するアカウントを確認してください。",
          );
        // Freeze the original identity; an account change in another tab must never redirect deletion.
        const authorization = `Bearer ${authData.session.access_token}`;
        await deleteCloudScope(
          owner,
          async () => {
            const { data: current, error: currentError } =
              await client.auth.getSession();
            if (currentError || current.session?.user.id !== owner)
              throw new Error("ログイン状態が変わりました");
            if (deleteMode === "account") {
              const { data, error } = await client.functions.invoke(
                "delete-account",
                {
                  body: { confirmation: "DELETE" },
                  headers: { Authorization: authorization },
                },
              );
              if (error || data?.success !== true)
                throw new Error("アカウント削除の応答を確認できませんでした");
            } else {
              const { error } = await client
                .rpc("life_partner_delete_data")
                .setHeader("Authorization", authorization);
              if (error) throw error;
            }
          },
          async () => {
            const { data: current, error: sessionError } =
              await client.auth.getSession();
            if (sessionError) throw sessionError;
            if (current.session?.user.id !== owner) return;
            const { error } = await client.auth.signOut();
            if (error) throw error;
          },
          deleteMode === "account",
        );
        notify(
          deleteMode === "account"
            ? "アカウントとクラウドデータを削除しました"
            : "クラウドと端末の記録を削除し、ログアウトしました",
        );
      } else {
        await clearOwner(owner);
        notify("この端末のローカル記録を削除しました");
      }
      setDeleteMode(null);
      setDeleteConfirm("");
    });
  const dateFormat = (v?: string) =>
    v ? new Date(v).toLocaleString("ja-JP") : "まだありません";
  return (
    <div className="stack settings-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR PREFERENCES</p>
          <h2>自分に合う使い方に</h2>
          <p className="muted">必要なものを、必要な分だけ。</p>
        </div>
        <SlidersHorizontal aria-hidden="true" size={28} />
      </div>
      <section className="card">
        <div className="section-heading">
          <h3>
            <Cloud size={21} aria-hidden="true" /> 保存とクラウド
          </h3>
          <span className="badge">
            {userEmail ? "クラウドモード" : "ローカルモード"}
          </span>
        </div>
        <p className="muted">
          入力はこの端末に保存されます。ローカル保存のみの場合、端末の故障・PWAの削除・ブラウザのデータ消去で記録を失う可能性があります。定期的にバックアップしてください。
        </p>
        {userEmail ? (
          <div className="stack">
            <p>
              <strong>{userEmail}</strong>
            </p>
            <p className="muted">
              最終同期：{dateFormat(lastSync)} ／ 同期待ち：{pending}件
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(syncNow)}
              >
                今すぐ同期
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (supabase) {
                      const { error } = await supabase.auth.signOut();
                      if (error) throw error;
                      notify("ログアウトしました。ローカルモードに戻ります。");
                    }
                  })
                }
              >
                ログアウト
              </button>
            </div>
            <p className="muted">
              ログアウトすると端末内の別アカウントの記録は表示されません。ローカルモードの記録は自動でアップロードされません。未同期の記録は端末に残り、同じアカウントでの次回ログイン時に再試行します。
            </p>
            <details
              open={recoveryOpen}
              onToggle={(e) => setRecoveryOpen(e.currentTarget.open)}
            >
              <summary>パスワードを変更する</summary>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (password.length < 8)
                      throw new Error(
                        "8文字以上のパスワードを入力してください",
                      );
                    const { error } = await supabase!.auth.updateUser({
                      password,
                    });
                    if (error) throw error;
                    setPassword("");
                    setRecoveryOpen(false);
                    notify("パスワードを変更しました");
                  });
                }}
              >
                <label className="field">
                  新しいパスワード
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  変更する
                </button>
              </form>
            </details>
          </div>
        ) : supabase ? (
          <div className="stack">
            <p>機種変更のときも記録を戻せるように、クラウドを利用できます。</p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void auth("login");
              }}
            >
              <label className="field">
                メールアドレス
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                パスワード（8文字以上）
                <input
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <div className="actions">
                <button className="primary" disabled={busy}>
                  ログイン
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void auth("signup")}
                >
                  新しく登録
                </button>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void auth("reset")}
              >
                パスワードを再設定
              </button>
            </form>
          </div>
        ) : (
          <p className="notice">
            クラウドは未設定です。開発者は DEPLOYMENT.md の手順で Supabase
            を設定できます。アカウントなしでも各機能とバックアップを利用できます。
          </p>
        )}
      </section>
      {conflictError && (
        <p className="notice" role="alert">
          {conflictError}
        </p>
      )}
      {conflicts.length > 0 && (
        <section className="card">
          <h3>
            <AlertCircle size={21} /> 内容を確認したい記録（{conflicts.length}
            件）
          </h3>
          <p className="muted">
            両方の内容を保持しています。確認して、使う内容を選んでください。選択前にバックアップを保存できます。
          </p>
          {conflicts.map((c) => (
            <div className="list-row stack" key={c.id}>
              <p>
                <strong>この端末：</strong>
                {describe(c.local)}
              </p>
              <p>
                <strong>
                  {c.source === "backup" ? "バックアップ" : "クラウド"}：
                </strong>
                {describe(c.remote)}
              </p>
              <details>
                <summary>記録の全項目を比較</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(
                    { この端末: c.local.data, 比較先: c.remote.data },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() =>
                    download(
                      JSON.stringify(c, null, 2),
                      `life-partner-conflict-${c.id}.json`,
                      "application/json",
                    )
                  }
                >
                  比較内容をJSON保存
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await resolveConflict(c.id, "local");
                      setConflicts(await getConflicts(owner));
                      notify("この端末の内容を選びました");
                    })
                  }
                >
                  この端末を使う
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await resolveConflict(c.id, "remote");
                      setConflicts(await getConflicts(owner));
                      notify("比較先の内容を選びました");
                    })
                  }
                >
                  比較先を使う
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h3>
          <SlidersHorizontal size={21} aria-hidden="true" /> 表示と使う機能
        </h3>
        <div className="form-grid">
          <label className="field">
            画面の明るさ
            <select
              value={draft.theme}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  theme: e.target.value as SettingsData["theme"],
                })
              }
            >
              <option value="system">端末に合わせる</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <label className="list-row row">
            <input
              type="checkbox"
              checked={draft.reduceMotion}
              onChange={(e) =>
                setDraft({ ...draft, reduceMotion: e.target.checked })
              }
            />{" "}
            アニメーションを抑える
          </label>
        </div>
        <fieldset>
          <legend>使う機能</legend>
          <div className="actions">
            {(
              [
                ["checklist", "忘れ物"],
                ["tasks", "タスク"],
                ["money", "お金"],
              ] as const
            ).map(([key, label]) => (
              <label className="row" key={key}>
                <input
                  type="checkbox"
                  checked={draft.features[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      features: { ...draft.features, [key]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void savePreferences()}
        >
          表示設定を保存
        </button>
      </section>
      <section className="card">
        <h3>
          <Database size={21} aria-hidden="true" /> バックアップと復元
        </h3>
        <p className="muted">
          JSONには生活記録・金銭情報が含まれます。信頼できる場所に保存し、他の人と共有しないでください。
        </p>
        <p className="muted">
          バックアップ作成：{dateFormat(settings.lastBackup)}
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void backup()}
          >
            <Download size={18} /> JSONを保存
          </button>
          <label
            className="secondary row"
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            style={{ cursor: "pointer" }}
            onKeyDown={(event) => {
              if (!busy && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                event.currentTarget
                  .querySelector<HTMLInputElement>("input")
                  ?.click();
              }
            }}
          >
            <Upload size={18} /> JSONから復元
            <input
              type="file"
              accept="application/json,.json"
              hidden
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadBackup(file);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                download(
                  await exportTransactionsCSV(owner),
                  `life-partner-money-${new Date().toISOString().slice(0, 10)}.csv`,
                  "text/csv;charset=utf-8",
                );
                notify("金銭記録のCSVを作成しました");
              })
            }
          >
            金銭記録をCSV保存
          </button>
        </div>
        {restoreText && (
          <div className="notice stack">
            <h4>復元前の確認</h4>
            <p>
              バックアップを現在の{userEmail ? "アカウント" : "ローカルモード"}
              に取り込みます。既存記録は消去せず、同じIDの異なる内容は競合として保存します。
            </p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {restorePreview}
            </pre>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void restore()}
              >
                確認して取り込む
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setRestoreText("");
                  setRestorePreview("");
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!navigator.storage?.persist) {
                setStorage(
                  "このブラウザでは保存領域の保護要求に対応していません。バックアップをご利用ください。",
                );
                return;
              }
              const granted = await navigator.storage.persist();
              setStorage(
                granted
                  ? "保存領域の保護が許可されました。バックアップも継続してください。"
                  : "保護は許可されませんでした。記録は通常保存されます。バックアップもご利用ください。",
              );
            })
          }
        >
          端末の保存領域の保護をリクエスト
        </button>
        {storage && (
          <p role="status" className="muted">
            {storage}
          </p>
        )}
      </section>
      <section className="card">
        <h3>
          <Bell size={21} aria-hidden="true" /> リマインダー
        </h3>
        <p className="muted">
          設定した日時を過ぎると、アプリ内でお知らせします。アプリを閉じている間のプッシュ通知・時刻指定通知は、このバージョンでは未実装です。
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await save("reminder", reminder);
              setReminder({ ...reminder, title: "" });
              notify("リマインダーを保存しました");
            });
          }}
        >
          <label className="field">
            お知らせの内容
            <input
              required
              maxLength={1000}
              placeholder="例：寝る前に支出を記録する"
              value={reminder.title}
              onChange={(e) =>
                setReminder({ ...reminder, title: e.target.value })
              }
            />
          </label>
          <div className="form-grid">
            <label className="field">
              種類
              <select
                value={reminder.type}
                onChange={(e) =>
                  setReminder({
                    ...reminder,
                    type: e.target.value as ReminderData["type"],
                  })
                }
              >
                {[
                  ["checklist", "忘れ物チェック"],
                  ["task", "タスク期限"],
                  ["repeat", "繰り返しタスク"],
                  ["payment", "支払い予定"],
                  ["payday", "給料日"],
                  ["expense", "支出記録"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              日付（空欄なら毎日）
              <input
                type="date"
                value={reminder.date}
                onChange={(e) =>
                  setReminder({ ...reminder, date: e.target.value })
                }
              />
            </label>
            <label className="field">
              時刻
              <input
                type="time"
                required
                value={reminder.time}
                onChange={(e) =>
                  setReminder({ ...reminder, time: e.target.value })
                }
              />
            </label>
          </div>
          <button className="secondary" disabled={busy}>
            お知らせを追加
          </button>
        </form>
        {ofKind(records, "reminder").map((r) => (
          <div className="list-row row spread" key={r.id}>
            <label className="row">
              <input
                type="checkbox"
                checked={r.data.enabled}
                onChange={(e) =>
                  void run(async () => {
                    await save(
                      "reminder",
                      { ...r.data, enabled: e.target.checked },
                      r.id,
                    );
                  })
                }
              />
              <span>
                {r.data.title}
                <small className="muted" style={{ display: "block" }}>
                  {r.data.date || "毎日"} {r.data.time}
                </small>
              </span>
            </label>
            <button
              className="icon-button"
              aria-label={`${r.data.title}を削除`}
              onClick={() => {
                if (window.confirm("このリマインダーを削除しますか？"))
                  void run(() => remove(r));
              }}
            >
              <Trash2 size={19} />
            </button>
          </div>
        ))}
        <details>
          <summary>ブラウザの通知許可について</summary>
          <p className="muted">
            現在は許可状態を確認するだけで、通知の配信は行いません。iPhoneのWeb
            PushにはiOS
            16.4以降・ホーム画面への追加・サーバー側の配信処理が必要です。
          </p>
          <p className="muted">
            通知許可：
            {notification === "unsupported"
              ? "このブラウザは未対応"
              : notification === "granted"
                ? "許可済み"
                : notification === "denied"
                  ? "拒否されています"
                  : "未設定"}
          </p>
          <button
            className="secondary"
            disabled={
              notification === "unsupported" || notification === "granted"
            }
            onClick={() =>
              void run(async () => {
                if (typeof Notification === "undefined") return;
                const permission = await Notification.requestPermission();
                setNotification(permission);
                notify(
                  "通知許可を確認しました。アプリ内のお知らせは引き続き利用できます。",
                );
              })
            }
          >
            通知の許可を確認する
          </button>
        </details>
      </section>
      <section className="card">
        <h3>
          <Smartphone size={21} aria-hidden="true" /> ホーム画面に追加する
        </h3>
        <ol className="stack">
          <li>iPhoneのSafariでこのアプリを開きます。</li>
          <li>共有ボタンをタップして「ホーム画面に追加」を選びます。</li>
          <li>「追加」をタップすると、アプリアイコンから起動できます。</li>
        </ol>
        <p className="muted">
          AndroidではChromeのメニューから「ホーム画面に追加」または「アプリをインストール」を選びます。オフラインで起動するには、最初に通信のある状態で一度開いてください。
        </p>
        <button
          className="secondary"
          onClick={() =>
            void run(async () => {
              if ("serviceWorker" in navigator) {
                const registration =
                  await navigator.serviceWorker.getRegistration();
                if (registration) {
                  await registration.update();
                  notify(
                    "アプリの更新を確認しました。端末の記録は保持されます。",
                  );
                } else notify("公開版でアプリ更新を確認できます");
              }
            })
          }
        >
          アプリの更新を確認
        </button>
        <p className="muted">
          アプリ更新用キャッシュの操作と、下の記録削除は別の処理です。
        </p>
      </section>
      <section className="card">
        <h3>
          <ShieldCheck size={21} aria-hidden="true" /> プライバシー
        </h3>
        <p>
          広告・アクセス解析・開発者向けの利用者監視は行いません。利用者の記録を外部AIサービスへ送信しません。
        </p>
        <p className="muted">
          クラウド利用時はSupabaseに認証情報と記録を保存します。利用者間のアクセスはRLSで制限しますが、クラウド事業者・適切な管理権限を持つデータベース管理者は技術的に内容へアクセスできる場合があります。端末内記録やJSONバックアップはアプリ独自の暗号化をしていません。端末のロックをご利用ください。
        </p>
        <p className="muted">
          Life
          Partnerは日常生活の補助ツールです。医療上の診断や治療を行うものではありません。
        </p>
      </section>
      <section className="card">
        <h3>
          <Trash2 size={21} aria-hidden="true" /> データの削除
        </h3>
        <p className="muted">
          削除前にJSONバックアップを保存してください。この操作は取り消せません。
        </p>
        <div className="actions">
          {!userEmail ? (
            <button className="danger" onClick={() => setDeleteMode("local")}>
              ローカル記録を削除
            </button>
          ) : (
            <>
              <button className="danger" onClick={() => setDeleteMode("cloud")}>
                このアカウントの全記録を削除
              </button>
              <button
                className="danger"
                onClick={() => setDeleteMode("account")}
              >
                アカウントを削除
              </button>
            </>
          )}
        </div>
      </section>
      {deleteMode && (
        <div className="modal-overlay">
          <div
            ref={modalRef}
            className="modal stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                setDeleteMode(null);
                setDeleteConfirm("");
              }
              if (event.key === "Tab") {
                const items = modalRef.current?.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input:not(:disabled)",
                );
                if (items?.length) {
                  const first = items[0],
                    last = items[items.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }
            }}
          >
            <h3 id="delete-title">
              {deleteMode === "account"
                ? "アカウントと全記録を削除"
                : deleteMode === "cloud"
                  ? "クラウドと端末の全記録を削除"
                  : "ローカル記録を削除"}
            </h3>
            <p>
              この操作は元に戻せません。
              {deleteMode !== "local"
                ? "他の端末に残るオフライン記録は、この端末から消去できません。全記録の削除後に別端末で同期すると、記録が再送信される場合があります。先に他の端末からログアウトしてください。"
                : ""}
            </p>
            <label className="field">
              確認のため「削除」と入力
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setDeleteMode(null);
                  setDeleteConfirm("");
                }}
              >
                キャンセル
              </button>
              <button
                className="danger"
                disabled={busy || deleteConfirm !== "削除"}
                onClick={() => void deleteData()}
              >
                <Check size={18} /> 削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
