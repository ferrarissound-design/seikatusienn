import type { FixedCostData, RecordOf, SettingsData } from "../types";
import {
  addMonths,
  daysBetween,
  daysInMonth,
  isDateString,
  localDate,
  monthKey,
} from "./dates";

export interface UpcomingFixedCost {
  id: string;
  title: string;
  amount: number;
  date: string;
  period: string;
}

export interface MonthlyTotal {
  expense: number;
  income: number;
}

export interface FinanceSummary {
  currentBalance: number;
  nextPayday: string;
  /** Today is included; the next payday is excluded. Always at least one. */
  daysUntilPayday: number;
  daysRemaining: number;
  upcomingFixedCosts: UpcomingFixedCost[];
  fixedCostsTotal: number;
  savingsReserved: number;
  /** Cash available after reserving unpaid bills and savings, before the monthly cap. */
  spendable: number;
  shortage: number;
  monthSpent: number;
  monthIncome: number;
  /** A zero monthlyBudget means not configured; this value is zero in that case. */
  monthlyRemaining: number;
  budgetUsage: number;
  budgetExceeded: number;
  dailyAllowance: number;
  categoryTotals: Record<string, number>;
  monthlyTotals: Record<string, MonthlyTotal>;
}

/** No floating-point yen: reject unsafe amounts or arithmetic rather than silently round. */
function yen(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new RangeError(
      "金額は安全に計算できる範囲の整数で入力してください。",
    );
  return value;
}
function total(values: number[]): number {
  return values.reduce((sum, value) => yen(sum + yen(value)), 0);
}
function validNonnegative(value: number): number {
  yen(value);
  if (value < 0) throw new RangeError("設定金額は0円以上で入力してください。");
  return value;
}
function dayInMonth(month: string, day: number): string {
  const [year, number] = month.split("-").map(Number);
  const actualDay = Math.min(day, daysInMonth(year, number - 1));
  return `${month}-${String(actualDay).padStart(2, "0")}`;
}
function validateFixedCost(fixed: FixedCostData): void {
  validNonnegative(fixed.amount);
  if (!Number.isInteger(fixed.day) || fixed.day < 1 || fixed.day > 31)
    throw new RangeError("固定費の日付は1〜31日で指定してください。");
}

/**
 * Estimate based solely on recorded data. A recorded balance is the opening balance
 * at the start of balanceDate. Actual transactions on that date and later adjust it.
 * Future transactions never enter either the available balance or spending totals.
 *
 * A salary expected in the future is never credited automatically. On payday we
 * target next month's payday; the user records received salary as an income.
 */
export function calculateFinance(
  settings: SettingsData,
  transactions: RecordOf<"transaction">[],
  fixedCosts: RecordOf<"fixedCost">[],
  today = localDate(),
): FinanceSummary {
  if (!isDateString(today) || !isDateString(settings.balanceDate))
    throw new RangeError("基準日が正しくありません。");
  validNonnegative(settings.balance);
  validNonnegative(settings.monthlyBudget);
  validNonnegative(settings.savings);
  if (
    !Number.isInteger(settings.payday) ||
    settings.payday < 1 ||
    settings.payday > 31
  )
    throw new RangeError("給料日は1〜31日で指定してください。");

  const month = monthKey(today);
  const paydayThisMonth = dayInMonth(month, settings.payday);
  const nextMonth = monthKey(addMonths(`${month}-01`, 1));
  const nextPayday =
    paydayThisMonth > today
      ? paydayThisMonth
      : dayInMonth(nextMonth, settings.payday);
  const daysRemaining = Math.max(1, daysBetween(today, nextPayday));
  const actual = transactions.filter((record) => {
    if (record.deleted) return false;
    validNonnegative(record.data.amount);
    if (!isDateString(record.data.date))
      throw new RangeError("記録の日付が正しくありません。");
    return record.data.date <= today;
  });
  const currentBalance = total([
    settings.balance,
    ...actual
      .filter((r) => r.data.date >= settings.balanceDate)
      .map((r) => (r.data.type === "income" ? r.data.amount : -r.data.amount)),
  ]);
  const monthly = actual.filter(
    (record) => monthKey(record.data.date) === month,
  );
  const monthSpent = total(
    monthly.filter((r) => r.data.type === "expense").map((r) => r.data.amount),
  );
  const monthIncome = total(
    monthly.filter((r) => r.data.type === "income").map((r) => r.data.amount),
  );

  const paid = new Set(
    actual
      .filter((r) => r.data.type === "expense" && r.data.fixedCostId)
      .map(
        (r) =>
          `${r.data.fixedCostId}:${r.data.fixedPeriod ?? monthKey(r.data.date)}`,
      ),
  );
  const upcomingFixedCosts: UpcomingFixedCost[] = [];
  // The interval to the next salary is at most a month and spans at most two periods.
  const periods = [...new Set([month, monthKey(nextPayday)])];
  for (const record of fixedCosts) {
    if (record.deleted) continue;
    validateFixedCost(record.data);
    for (const period of periods) {
      const date = dayInMonth(period, record.data.day);
      // Keep overdue bills in this month reserved until explicitly recorded as paid.
      if (date < nextPayday && !paid.has(`${record.id}:${period}`)) {
        upcomingFixedCosts.push({
          id: record.id,
          title: record.data.title,
          amount: record.data.amount,
          date,
          period,
        });
      }
    }
  }
  upcomingFixedCosts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ja"),
  );
  const fixedCostsTotal = total(upcomingFixedCosts.map((cost) => cost.amount));
  const afterReservations = total([
    currentBalance,
    -fixedCostsTotal,
    -settings.savings,
  ]);
  const shortage = Math.max(0, -afterReservations);
  const spendable = Math.max(0, afterReservations);
  const monthlyRemaining =
    settings.monthlyBudget > 0
      ? Math.max(0, settings.monthlyBudget - monthSpent)
      : 0;
  const budgetExceeded =
    settings.monthlyBudget > 0
      ? Math.max(0, monthSpent - settings.monthlyBudget)
      : 0;
  const dailyAllowance = Math.floor(
    Math.min(
      spendable,
      settings.monthlyBudget > 0 ? monthlyRemaining : spendable,
    ) / daysRemaining,
  );

  const categories = new Map<string, number>();
  for (const record of monthly.filter((r) => r.data.type === "expense")) {
    const category = record.data.category || "その他";
    categories.set(
      category,
      total([categories.get(category) ?? 0, record.data.amount]),
    );
  }
  const months = new Map<string, MonthlyTotal>();
  for (const record of actual) {
    const key = monthKey(record.data.date);
    const row = months.get(key) ?? { expense: 0, income: 0 };
    const field = record.data.type === "expense" ? "expense" : "income";
    row[field] = total([row[field], record.data.amount]);
    months.set(key, row);
  }
  return {
    currentBalance,
    nextPayday,
    daysUntilPayday: daysRemaining,
    daysRemaining,
    upcomingFixedCosts,
    fixedCostsTotal,
    savingsReserved: settings.savings,
    spendable,
    shortage,
    monthSpent,
    monthIncome,
    monthlyRemaining,
    budgetUsage:
      settings.monthlyBudget > 0
        ? (monthSpent / settings.monthlyBudget) * 100
        : 0,
    budgetExceeded,
    dailyAllowance,
    categoryTotals: Object.fromEntries(
      [...categories].sort((a, b) => b[1] - a[1]),
    ),
    monthlyTotals: Object.fromEntries(
      [...months].sort((a, b) => b[0].localeCompare(a[0])),
    ),
  };
}

export function money(value: number): string {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value)}円`;
}
