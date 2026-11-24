import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  HeartHandshake,
  House,
  BriefcaseBusiness,
  ListTodo,
  Wallet,
  Settings as SettingsIcon,
  Check,
  Plus,
  Cloud,
  CloudOff,
  WifiOff,
  ChevronRight,
  Sun,
  Bell,
  ArrowUpRight,
  ShieldCheck,
  RotateCcw,
  X,
  CalendarDays,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type {
  AnyRecord,
  DataMap,
  Kind,
  SettingsData,
  PageProps,
} from "./types";
import { DEFAULT_SETTINGS, ofKind } from "./types";
import {
  db,
  getRecords,
  saveRecord,
  deleteRecord,
  restoreRecord,
  getPendingCount,
} from "./lib/db";
import { supabase, syncOwner } from "./lib/sync";
import { localDate } from "./lib/dates";
import { calculateFinance } from "./lib/finance";
import { completeTask, runRollover } from "./lib/rollover";
import { setChecklistItem } from "./lib/recordActions";
import { Money, yen } from "./components/Money";
import { Tasks } from "./components/Tasks";
import { Checklists } from "./components/Checklists";
import { Settings } from "./components/Settings";

type Page = "home" | "checklist" | "tasks" | "money" | "settings";
const nav = [
  { id: "home", label: "ホーム", icon: House },
  { id: "checklist", label: "忘れ物", icon: BriefcaseBusiness },
  { id: "tasks", label: "タスク", icon: ListTodo },
  { id: "money", label: "お金", icon: Wallet },
  { id: "settings", label: "設定", icon: SettingsIcon },
] as const;
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authReady, setAuthReady] = useState(!supabase);
  const [page, setPage] = useState<Page>("home");
  const [online, setOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<AnyRecord | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [storageFailure, setStorageFailure] = useState<{
    owner: string;
    message: string;
  } | null>(null);
  const [update, setUpdate] = useState(false);
  const [quick, setQuick] = useState(false);
  const [date, setDate] = useState(localDate());
  const [clock, setClock] = useState(new Date().toTimeString().slice(0, 5));
  const owner = user?.id ?? "local";
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const recordResult = useLiveQuery(async () => {
    try {
      const data = await getRecords(owner);
      if (ownerRef.current === owner) setStorageFailure(null);
      return { owner, data };
    } catch {
      if (ownerRef.current === owner)
        setStorageFailure({
          owner,
          message:
            "端末への保存領域を開けません。Safariの設定や空き容量をご確認ください。データの削除は行わず、再読み込みをお試しください。",
        });
      return { owner, data: undefined };
    }
  }, [owner]);
  const records = recordResult?.owner === owner ? recordResult.data : undefined;
  const storageError =
    storageFailure?.owner === owner ? storageFailure.message : "";
  const pendingResult = useLiveQuery(
    async () => ({ owner, count: await getPendingCount(owner).catch(() => 0) }),
    [owner],
  );
  const pending = pendingResult?.owner === owner ? pendingResult.count : 0;
  const lastSyncResult = useLiveQuery(
    async () => ({
      owner,
      entry: await db.meta.get(`${owner}:lastSync`).catch(() => undefined),
    }),
    [owner],
  );
  const lastSync =
    lastSyncResult?.owner === owner ? lastSyncResult.entry : undefined;
  const settings = ofKind(records ?? [], "settings")[0]?.data ?? {
    ...DEFAULT_SETTINGS,
    balanceDate: date,
  };
  const notify = useCallback((message: string) => setNotice(message), []);
  const safeSave = useCallback(
    async <K extends Kind>(kind: K, data: DataMap[K], id?: string) => {
      try {
        await saveRecord(
          owner,
          kind,
          data,
          id ?? (kind === "settings" ? "settings" : undefined),
        );
      } catch (e) {
        setNotice(
          e instanceof Error && e.message.includes("競合")
            ? e.message
            : "保存できませんでした。入力内容を残したまま、空き容量や入力値を確認してください。",
        );
        throw e;
      }
    },
    [owner],
  );
  const remove = useCallback(async (record: AnyRecord) => {
    try {
      await deleteRecord(record);
      if (ownerRef.current === record.owner) {
        setUndo(record);
        setNotice("記録を削除しました");
      }
    } catch (e) {
      setNotice("削除できませんでした。記録は保持されています。");
      throw e;
    }
  }, []);
  const syncNow = useCallback(async () => {
    const active = owner;
    if (!supabase || active === "local") return;
    setSyncing(true);
    try {
      const result = await syncOwner(active);
      if (ownerRef.current !== active) return;
      setSyncError(
        result.status === "error"
          ? (result.message ??
              "同期できませんでした。端末の記録は保持されています。")
          : result.status === "offline"
            ? "オフラインです。次の接続時に再試行します。"
            : "",
      );
      if (result.conflicts)
        setNotice(
          "同期内容に違いがあります。設定から両方の記録を確認してください。",
        );
    } catch {
      if (ownerRef.current === active)
        setSyncError("同期を待っています。端末の記録は保持されています。");
    } finally {
      setSyncing(false);
    }
  }, [owner]);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let observed = false;
    let authOwner: string | null = null;
    const apply = (next: User | null, event?: string) => {
      if (!active) return;
      const nextId = next?.id ?? null;
      if (authOwner !== nextId) {
        authOwner = nextId;
        setPage("home");
        setUndo(null);
        setQuick(false);
        setNotice("");
        setSyncError("");
        setPasswordRecovery(false);
      }
      setUser(next);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setPage("settings");
        setNotice("新しいパスワードを設定してください");
      }
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      observed = true;
      apply(session?.user ?? null, event);
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!observed) apply(data.session?.user ?? null);
        if (active && error)
          setSyncError(
            "ログイン状態を確認できません。設定から再度ログインしてください。",
          );
      })
      .catch(() => {
        if (active && !observed) setAuthReady(true);
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const tick = () => {
      setDate(localDate());
      setClock(new Date().toTimeString().slice(0, 5));
      if (document.visibilityState === "visible")
        void runRollover(owner).catch(() =>
          setNotice(
            "日付の更新処理を保存できませんでした。再起動時に再試行します。",
          ),
        );
    };
    const updated = () => setUpdate(true);
    const swError = () =>
      setNotice(
        "オフライン起動の準備が完了していません。接続中にもう一度開いてください。",
      );
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("app-update", updated);
    window.addEventListener("sw-error", swError);
    document.addEventListener("visibilitychange", tick);
    const timer = window.setInterval(tick, 60000);
    tick();
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("app-update", updated);
      window.removeEventListener("sw-error", swError);
      document.removeEventListener("visibilitychange", tick);
      clearInterval(timer);
    };
  }, [owner]);
  useEffect(() => {
    if (!authReady || !online) return;
    void syncNow();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [authReady, online, syncNow]);
  useEffect(() => {
    if (!pending || !online || owner === "local") return;
    const timer = setTimeout(() => void syncNow(), 1200);
    return () => clearTimeout(timer);
  }, [pending, online, owner, syncNow]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.motion = settings.reduceMotion
      ? "reduced"
      : "normal";
  }, [settings.theme, settings.reduceMotion]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, owner]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice("");
      setUndo(null);
    }, 12000);
    return () => clearTimeout(timer);
  }, [notice]);
  const props: PageProps = {
    records: records ?? [],
    owner,
    save: safeSave,
    remove,
    notify,
  };
  const status = !online
    ? "オフライン · 端末に保存"
    : user
      ? syncing
        ? "同期中…"
        : pending
          ? `同期待ち ${pending} 件`
          : "クラウド同期"
      : "端末に保存 · ローカルモード";
  if (!authReady)
    return (
      <main className="loading">
        <HeartHandshake size={42} />
        <p>Life Partner を開いています…</p>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setPage("home")}
          aria-label="Life Partner ホーム"
        >
          <span className="brand-icon">
            <HeartHandshake size={25} />
          </span>
          <span>
            Life Partner<small>毎日に、少しの安心を。</small>
          </span>
        </button>
        <div className="header-end">
          <span className="private-label">
            <ShieldCheck size={15} />
            あなたのための場所
          </span>
          <button
            className="avatar"
            aria-label="設定を開く"
            onClick={() => setPage("settings")}
          >
            {user ? "M" : <SettingsIcon size={20} />}
          </button>
        </div>
      </header>
      <aside className="desktop-nav" aria-label="メインメニュー">
        <span className="nav-caption">MY DAILY PARTNER</span>
        {nav
          .filter(
            (n) =>
              n.id === "home" ||
              n.id === "settings" ||
              settings.features[
                n.id === "checklist"
                  ? "checklist"
                  : n.id === "tasks"
                    ? "tasks"
                    : "money"
              ],
          )
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
        <div className="sidebar-note">
          <HeartHandshake size={27} />
          <p>
            あなたのペースで、
            <br />
            ひとつずつ。
          </p>
          <small>全部できなくても大丈夫。</small>
        </div>
      </aside>
      <main id="main-content" key={owner}>
        <div className="save-status">
          <span className={`status-pill ${!online ? "offline" : ""}`}>
            {!online ? (
              <WifiOff size={14} />
            ) : user ? (
              <Cloud size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}{" "}
            {status}
          </span>
          <button className="text-button" onClick={() => setPage("settings")}>
            保存状況 <ChevronRight size={14} />
          </button>
        </div>
        {syncError && (
          <div className="notice error" role="status">
            {syncError}
            <button className="text-button" onClick={() => void syncNow()}>
              再試行
            </button>
          </div>
        )}
        {storageError ? (
          <div className="card notice error" role="alert">
            <h2>保存領域を確認してください</h2>
            <p>{storageError}</p>
            <button className="secondary" onClick={() => location.reload()}>
              再読み込み
            </button>
          </div>
        ) : !records ? (
          <div className="loading">保存した記録を読み込んでいます…</div>
        ) : (
          <>
            {update && (
              <div className="notice row spread">
                <span>
                  新しいバージョンを利用できます。端末の記録は保持されます。
                </span>
                <button
                  className="secondary"
                  onClick={async () => {
                    const reg = await navigator.serviceWorker.getRegistration();
                    if (reg?.waiting) {
                      reg.waiting.postMessage("ACTIVATE_UPDATE");
                      navigator.serviceWorker.addEventListener(
                        "controllerchange",
                        () => location.reload(),
                        { once: true },
                      );
                    } else location.reload();
                  }}
                >
                  更新する
                </button>
              </div>
            )}
            {!settings.onboarded && page === "home" && (
              <Welcome
                settings={settings}
                save={safeSave}
                settingsId={ofKind(records, "settings")[0]?.id}
                openSettings={() => setPage("settings")}
              />
            )}
            <ScreenBoundary key={page} settings={() => setPage("settings")}>
              {page === "home" && (
                <Dashboard
                  {...props}
                  settings={settings}
                  date={date}
                  time={clock}
                  open={setPage}
                  expense={() => {
                    setPage("money");
                    setQuick(true);
                  }}
                />
              )}
              {page === "tasks" && <Tasks {...props} />}
              {page === "checklist" && <Checklists {...props} />}
              {page === "money" && (
                <Money
                  key={quick ? "quick" : "money"}
                  {...props}
                  settings={settings}
                  quickAdd={quick}
                  onQuickDone={() => setQuick(false)}
                />
              )}
              {page === "settings" && (
                <Settings
                  {...props}
                  settings={settings}
                  userEmail={user?.email}
                  syncNow={syncNow}
                  lastSync={lastSync?.value}
                  pending={pending}
                  passwordRecovery={passwordRecovery}
                />
              )}
            </ScreenBoundary>
          </>
        )}
        <footer className="page-footer">
          <HeartHandshake size={15} />
          小さな一歩を、あなたのペースで。<span>Life Partner</span>
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {nav
          .filter(
            (n) =>
              n.id === "home" ||
              n.id === "settings" ||
              settings.features[
                n.id === "checklist"
                  ? "checklist"
                  : n.id === "tasks"
                    ? "tasks"
                    : "money"
              ],
          )
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          {undo && (
            <button
              onClick={async () => {
                try {
                  await restoreRecord(undo);
                  setUndo(null);
                  setNotice("元に戻しました");
                } catch {
                  setNotice(
                    "元に戻せませんでした。設定から記録の競合をご確認ください。",
                  );
                }
              }}
            >
              <RotateCcw size={16} />
              元に戻す
            </button>
          )}
          <button aria-label="メッセージを閉じる" onClick={() => setNotice("")}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function Welcome({
  settings,
  save,
  settingsId,
  openSettings,
}: {
  settings: SettingsData;
  save: PageProps["save"];
  settingsId?: string;
  openSettings: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(settings.features);
  return (
    <section className="welcome-card">
      <div>
        <span className="eyebrow">はじめまして</span>
        <h2>
          毎日の「ちょっと困った」に、
          <br className="mobile-only" />
          ひとつのパートナー。
        </h2>
        <p>持ち物、やること、お金のこと。必要なところから使えます。</p>
      </div>
      {expanded ? (
        <div className="stack">
          <fieldset>
            <legend>使いたい機能（あとから変更できます）</legend>
            <div className="row wrap">
              {(
                [
                  ["checklist", "忘れ物"],
                  ["tasks", "タスク"],
                  ["money", "お金"],
                ] as const
              ).map(([key, label]) => (
                <label className="check-label" key={key}>
                  <input
                    type="checkbox"
                    checked={selected[key]}
                    onChange={(e) =>
                      setSelected({ ...selected, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="actions">
            <button
              className="primary"
              onClick={async () => {
                try {
                  await save(
                    "settings",
                    { ...settings, features: selected, onboarded: true },
                    settingsId,
                  );
                  openSettings();
                } catch {
                  /* Save error is shown by the shared handler; preserve the selection. */
                }
              }}
            >
              設定を続ける
            </button>
            <button
              className="text-button"
              onClick={() => {
                void save(
                  "settings",
                  { ...settings, features: selected, onboarded: true },
                  settingsId,
                ).catch(() => {});
              }}
            >
              このまま始める
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button className="primary" onClick={() => setExpanded(true)}>
            使い方を選ぶ
          </button>
          <button
            className="text-button"
            onClick={() => {
              void save(
                "settings",
                { ...settings, onboarded: true },
                settingsId,
              ).catch(() => {});
            }}
          >
            あとで設定する
          </button>
        </div>
      )}
    </section>
  );
}
function Dashboard(
  props: PageProps & {
    settings: SettingsData;
    date: string;
    time: string;
    open: (page: Page) => void;
    expense: () => void;
  },
) {
  const { records, settings, date, open, save, notify } = props;
  const todayTasks = ofKind(records, "task").filter(
    (t) => !t.data.completed && (!t.data.due || t.data.due <= date),
  );
  const checks = ofKind(records, "checklist");
  const activeCheck = checks[0];
  const checked = activeCheck?.data.items.filter((i) => i.checked).length ?? 0;
  const f = calculateFinance(
    settings,
    ofKind(records, "transaction"),
    ofKind(records, "fixedCost"),
    date,
  );
  const schedule = ofKind(records, "task")
    .filter((t) => !t.data.completed && t.data.due > date)
    .sort((a, b) => a.data.due.localeCompare(b.data.due))
    .slice(0, 3);
  const dueReminders = ofKind(records, "reminder").filter(
    (r) =>
      r.data.enabled &&
      r.data.acknowledgedOn !== date &&
      (!r.data.date || r.data.date <= date) &&
      ((r.data.date && r.data.date < date) || r.data.time <= props.time),
  );
  const displayDate = new Date(`${date}T12:00:00`);
  return (
    <div className="page dashboard stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat("en", { month: "long", year: "numeric" })
              .format(displayDate)
              .toUpperCase()}
          </p>
          <h1>
            今日も、あなたのペースで。
            <Sun className="greeting-sun" size={29} />
          </h1>
          <p className="date-label">
            {new Intl.DateTimeFormat("ja-JP", {
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(displayDate)}
          </p>
        </div>
        <span className="today-badge">
          <CalendarDays size={17} />
          今日の見通し
        </span>
      </div>
      {dueReminders.length > 0 && (
        <section className="notice reminders">
          <Bell size={20} />
          <div>
            <strong>思い出すお手伝い</strong>
            {dueReminders.map((r) => (
              <div key={r.id} className="row spread">
                <span>
                  {r.data.time} · {r.data.title}
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    void save(
                      "reminder",
                      {
                        ...r.data,
                        ...(r.data.date
                          ? { enabled: false }
                          : { acknowledgedOn: date }),
                      },
                      r.id,
                    ).catch(() => {});
                  }}
                >
                  確認した
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="dashboard-top">
        {settings.features.money && (
          <section className="daily-money">
            <div className="row spread">
              <span className="row">
                <span className="hero-icon">
                  <Wallet size={22} />
                </span>
                今日使える目安
              </span>
              <button
                aria-label="お金の詳細を開く"
                className="hero-link"
                onClick={() => open("money")}
              >
                <ArrowUpRight size={21} />
              </button>
            </div>
            <p className="hero-amount">
              {yen(f.dailyAllowance)}
              <small> / 日</small>
            </p>
            <p className="hero-caption">
              次の給料日まで、今日を含めて <strong>{f.daysRemaining} 日</strong>
            </p>
            <div className="hero-divider" />
            <div className="row spread">
              <div>
                <small>いまの利用可能残高</small>
                <strong>{yen(f.currentBalance)}</strong>
              </div>
              <button className="light-button" onClick={props.expense}>
                <Plus size={18} />
                支出を記録
              </button>
            </div>
            <small className="hero-disclaimer">
              登録した情報に基づく目安です
            </small>
          </section>
        )}
        <section className="gentle-card">
          <div className="gentle-art">
            <div className="art-leaf leaf-one" />
            <div className="art-leaf leaf-two" />
            <div className="art-leaf leaf-three" />
            <div className="art-pot" />
            <span className="art-spark spark-one">✦</span>
            <span className="art-spark spark-two">✧</span>
          </div>
          <p className="eyebrow">A LITTLE AT A TIME</p>
          <h2>ひとつずつで、大丈夫。</h2>
          <p>
            今日のあなたに合うペースで。
            <br />
            ここから、少しずつ始めましょう。
          </p>
        </section>
      </div>
      <div className="dashboard-columns">
        {settings.features.tasks && (
          <section className="card dashboard-card">
            <div className="section-heading">
              <h2>
                <span className="section-icon lavender">
                  <ListTodo size={20} />
                </span>
                今日やること{" "}
                <span className="count-badge">{todayTasks.length}</span>
              </h2>
              <button className="text-button" onClick={() => open("tasks")}>
                すべて見る
                <ChevronRight size={16} />
              </button>
            </div>
            {todayTasks.length === 0 ? (
              <div className="empty-state compact">
                <ListTodo size={31} />
                <h3>今日は、ここから。</h3>
                <p>頭の中のやることを、ひとつ置いてみましょう。</p>
                <button className="secondary" onClick={() => open("tasks")}>
                  <Plus size={17} />
                  タスクを追加
                </button>
              </div>
            ) : (
              <div className="stack compact-stack">
                {todayTasks.slice(0, 4).map((t) => (
                  <div className="task-preview list-row" key={t.id}>
                    <button
                      className="check-button"
                      aria-label={`${t.data.title}を完了`}
                      onClick={async () => {
                        try {
                          await completeTask(props.owner, t, true);
                          notify("完了を記録しました。おつかれさまです。");
                        } catch {
                          notify(
                            "保存できませんでした。もう一度お試しください。",
                          );
                        }
                      }}
                    >
                      <span />
                    </button>
                    <div className="grow">
                      <strong>{t.data.title}</strong>
                      <small>
                        {t.data.category || "やること"}
                        {t.data.priority === "high" ? " · 優先度 高" : ""}
                        {t.data.due && t.data.due < date
                          ? " · 今日も取り組めます"
                          : ""}
                      </small>
                    </div>
                  </div>
                ))}
                <button className="add-inline" onClick={() => open("tasks")}>
                  <Plus size={17} />
                  やることを追加
                </button>
              </div>
            )}
            <div className="card-footnote">
              あとで取り組んでも大丈夫。あなたのペースで。
            </div>
          </section>
        )}
        {settings.features.checklist && (
          <section className="card dashboard-card">
            <div className="section-heading">
              <h2>
                <span className="section-icon peach">
                  <BriefcaseBusiness size={20} />
                </span>
                忘れ物チェック
              </h2>
              <button className="text-button" onClick={() => open("checklist")}>
                すべて見る
                <ChevronRight size={16} />
              </button>
            </div>
            {!activeCheck ? (
              <div className="empty-state compact">
                <BriefcaseBusiness size={31} />
                <h3>安心して、いってらっしゃい。</h3>
                <p>外出に必要なものを、ここにまとめられます。</p>
                <button className="secondary" onClick={() => open("checklist")}>
                  <Plus size={17} />
                  チェックリストを作る
                </button>
              </div>
            ) : (
              <>
                <div className="row spread checklist-label">
                  <strong>{activeCheck.data.title}</strong>
                  <span className="muted">
                    {checked} / {activeCheck.data.items.length} 確認済み
                  </span>
                </div>
                <progress
                  className="progress"
                  max={activeCheck.data.items.length || 1}
                  value={checked}
                />
                {activeCheck.data.items.slice(0, 4).map((item) => (
                  <label
                    className={`home-check ${item.checked ? "is-checked" : ""}`}
                    key={item.id}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => {
                        void setChecklistItem(
                          props.owner,
                          activeCheck.id,
                          item.id,
                          e.target.checked,
                        ).catch(() =>
                          notify(
                            "チェックを保存できませんでした。もう一度お試しください。",
                          ),
                        );
                      }}
                    />
                    <span>{item.title}</span>
                    {item.checked && <Check size={17} />}
                  </label>
                ))}
                {activeCheck.data.items.length > 0 &&
                  checked === activeCheck.data.items.length && (
                    <p className="notice">
                      全部確認できました。安心して出かけましょう。
                    </p>
                  )}
              </>
            )}
            <div className="card-footnote">
              <ShieldCheck size={14} />
              チェックするたびに、自動で保存します。
            </div>
          </section>
        )}
      </div>
      <div className="dashboard-bottom">
        <section className="card">
          <div className="section-heading">
            <h2>
              <CalendarDays size={20} />
              これからの予定
            </h2>
            <button className="text-button" onClick={() => open("tasks")}>
              予定を追加
              <Plus size={15} />
            </button>
          </div>
          {schedule.length ? (
            schedule.map((t) => (
              <div key={t.id} className="list-row">
                <span className="schedule-date">
                  {t.data.due.slice(5).replace("-", "/")}
                </span>
                <strong>{t.data.title}</strong>
              </div>
            ))
          ) : (
            <p className="empty-text">
              この先の予定はまだありません。期限のあるタスクがここに表示されます。
            </p>
          )}
        </section>
        <section className="card shortcut-card">
          <h2>すぐにアクセス</h2>
          <div className="shortcut-grid">
            {settings.features.money && (
              <button onClick={props.expense}>
                <Wallet size={22} />
                <span>支出を記録</span>
              </button>
            )}
            {settings.features.tasks && (
              <button onClick={() => open("tasks")}>
                <ListTodo size={22} />
                <span>タスクを追加</span>
              </button>
            )}
            <button onClick={() => open("settings")}>
              <CloudOff size={22} />
              <span>バックアップ</span>
            </button>
          </div>
        </section>
      </div>
      {props.owner === "local" && (
        <section className="local-backup-note row">
          <ShieldCheck size={20} />
          <p>
            いまの記録は、この端末に保存されています。端末の故障やデータ消去に備えて、JSONバックアップをご利用ください。
          </p>
          <button className="text-button" onClick={() => open("settings")}>
            保存方法を見る
          </button>
        </section>
      )}
    </div>
  );
}
class ScreenBoundary extends Component<
  { children: ReactNode; settings: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="card stack" role="alert">
        <h2>この画面を表示できませんでした</h2>
        <p>
          記録は削除されていません。金額の合計が大きすぎる場合など、内容の確認が必要です。設定からバックアップを保存し、記録を確認してください。
        </p>
        <button className="primary" onClick={this.props.settings}>
          設定とバックアップを開く
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}
export default App;
