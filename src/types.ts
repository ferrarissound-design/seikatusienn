export type Kind =
  | "task"
  | "checklist"
  | "checkHistory"
  | "transaction"
  | "fixedCost"
  | "settings"
  | "reminder";
export interface Meta {
  id: string;
  kind: Kind;
  owner: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deleted: boolean;
}
export interface TaskData {
  title: string;
  due: string;
  priority: "low" | "normal" | "high";
  category: string;
  memo: string;
  completed: boolean;
  completedAt?: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  steps: { id: string; title: string; done: boolean }[];
}
export interface ChecklistData {
  title: string;
  items: { id: string; title: string; checked: boolean }[];
  resetTime: string;
  lastReset: string;
}
export interface CheckHistoryData {
  checklistId: string;
  title: string;
  date: string;
  checked: number;
  total: number;
  items: { title: string; checked: boolean }[];
}
export interface TransactionData {
  type: "expense" | "income";
  amount: number;
  category: string;
  memo: string;
  date: string;
  fixedCostId?: string;
  fixedPeriod?: string;
}
export interface FixedCostData {
  title: string;
  amount: number;
  day: number;
}
export interface SettingsData {
  balance: number;
  balanceDate: string;
  monthlyBudget: number;
  payday: number;
  savings: number;
  savingsTitle: string;
  theme: "light" | "dark" | "system";
  reduceMotion: boolean;
  features: { checklist: boolean; tasks: boolean; money: boolean };
  onboarded: boolean;
  lastBackup?: string;
}
export interface ReminderData {
  acknowledgedOn?: string;
  title: string;
  date: string;
  time: string;
  enabled: boolean;
  type: "checklist" | "task" | "repeat" | "payment" | "payday" | "expense";
}
export interface DataMap {
  task: TaskData;
  checklist: ChecklistData;
  checkHistory: CheckHistoryData;
  transaction: TransactionData;
  fixedCost: FixedCostData;
  settings: SettingsData;
  reminder: ReminderData;
}
export type RecordOf<K extends Kind> = Meta & { kind: K; data: DataMap[K] };
export type AnyRecord = { [K in Kind]: RecordOf<K> }[Kind];
export const DEFAULT_SETTINGS: SettingsData = {
  balance: 0,
  balanceDate: new Date().toLocaleDateString("sv-SE"),
  monthlyBudget: 0,
  payday: 25,
  savings: 0,
  savingsTitle: "安心のための貯金",
  theme: "system",
  reduceMotion: false,
  features: { checklist: true, tasks: true, money: true },
  onboarded: false,
};
export interface PageProps {
  records: AnyRecord[];
  owner: string;
  save: <K extends Kind>(
    kind: K,
    data: DataMap[K],
    id?: string,
  ) => Promise<void>;
  remove: (record: AnyRecord) => Promise<void>;
  notify: (message: string) => void;
}
export const ofKind = <K extends Kind>(
  records: AnyRecord[],
  kind: K,
): RecordOf<K>[] =>
  records.filter((r) => r.kind === kind && !r.deleted) as RecordOf<K>[];
