import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  type RecordOf,
  type SettingsData,
  type TransactionData,
} from "../types";
import { calculateFinance, money } from "./finance";

const settings = (data: Partial<SettingsData> = {}): SettingsData => ({
  ...DEFAULT_SETTINGS,
  balance: 100_000,
  balanceDate: "2026-11-01",
  monthlyBudget: 0,
  payday: 25,
  savings: 0,
  ...data,
});
let sequence = 0;
const transaction = (
  data: Partial<TransactionData>,
): RecordOf<"transaction"> => ({
  id: `transaction-${++sequence}`,
  kind: "transaction",
  owner: "local",
  version: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  deleted: false,
  data: {
    type: "expense",
    amount: 1_000,
    category: "食費",
    memo: "",
    date: "2026-11-24",
    ...data,
  },
});
const fixedCost = (
  data: Partial<RecordOf<"fixedCost">["data"]> = {},
  id = "rent",
): RecordOf<"fixedCost"> => ({
  id,
  kind: "fixedCost",
  owner: "local",
  version: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  deleted: false,
  data: { title: "家賃", amount: 30_000, day: 24, ...data },
});

describe("calculateFinance", () => {
  it("counts today and excludes tomorrow payday, then floors integer yen", () => {
    const result = calculateFinance(
      settings({ balance: 1_001, savings: 100 }),
      [],
      [],
      "2026-11-24",
    );
    expect(result.nextPayday).toBe("2026-11-25");
    expect(result.daysRemaining).toBe(1);
    expect(result.dailyAllowance).toBe(901);
  });

  it("on payday uses the next month and never automatically credits salary", () => {
    const result = calculateFinance(
      settings({ balance: 0 }),
      [],
      [],
      "2026-11-25",
    );
    expect(result.nextPayday).toBe("2026-12-25");
    expect(result.daysRemaining).toBe(30);
    expect(result.dailyAllowance).toBe(0);
  });

  it("includes recorded salary on payday and excludes every future transaction", () => {
    const result = calculateFinance(
      settings({ balance: 0 }),
      [
        transaction({ type: "income", amount: 90_000, date: "2026-11-25" }),
        transaction({ type: "income", amount: 90_000, date: "2026-12-25" }),
        transaction({ amount: 20_000, date: "2026-11-26" }),
      ],
      [],
      "2026-11-25",
    );
    expect(result.currentBalance).toBe(90_000);
    expect(result.dailyAllowance).toBe(3_000);
    expect(result.monthIncome).toBe(90_000);
    expect(result.monthSpent).toBe(0);
  });

  it("only adjusts the opening balance from its anchor day onwards", () => {
    const result = calculateFinance(
      settings({ balance: 5_000, balanceDate: "2026-11-23" }),
      [
        transaction({ amount: 2_000, date: "2026-11-22" }),
        transaction({ amount: 1_000, date: "2026-11-23" }),
        transaction({ type: "income", amount: 500, date: "2026-11-24" }),
      ],
      [],
      "2026-11-24",
    );
    expect(result.currentBalance).toBe(4_500);
    expect(result.monthSpent).toBe(3_000);
  });

  it("reserves unpaid fixed costs once and does not double subtract a paid bill", () => {
    const bill = fixedCost();
    const result = calculateFinance(
      settings(),
      [
        transaction({
          amount: 30_000,
          fixedCostId: bill.id,
          fixedPeriod: "2026-11",
        }),
      ],
      [bill],
      "2026-11-24",
    );
    expect(result.currentBalance).toBe(70_000);
    expect(result.fixedCostsTotal).toBe(0);
    expect(result.spendable).toBe(70_000);
  });

  it("does not treat last month payment or a future payment as this month paid", () => {
    const bill = fixedCost();
    const result = calculateFinance(
      settings(),
      [
        transaction({
          amount: 30_000,
          date: "2026-10-24",
          fixedCostId: bill.id,
          fixedPeriod: "2026-10",
        }),
        transaction({
          amount: 30_000,
          date: "2026-11-25",
          fixedCostId: bill.id,
          fixedPeriod: "2026-11",
        }),
      ],
      [bill],
      "2026-11-24",
    );
    expect(result.fixedCostsTotal).toBe(30_000);
  });

  it("reserves fixed costs in both calendar months until the next payday", () => {
    const result = calculateFinance(
      settings(),
      [
        transaction({
          date: "2026-11-05",
          amount: 30_000,
          fixedCostId: "phone",
          fixedPeriod: "2026-11",
        }),
      ],
      [fixedCost({ day: 28 }, "insurance"), fixedCost({ day: 5 }, "phone")],
      "2026-11-26",
    );
    expect(result.upcomingFixedCosts.map((cost) => cost.date)).toEqual([
      "2026-11-28",
      "2026-12-05",
    ]);
    expect(result.fixedCostsTotal).toBe(60_000);
  });

  it("keeps earlier current-month unpaid bills reserved until payment is recorded", () => {
    const result = calculateFinance(
      settings(),
      [],
      [fixedCost({ day: 5 })],
      "2026-11-24",
    );
    expect(result.fixedCostsTotal).toBe(30_000);
    expect(result.upcomingFixedCosts[0].date).toBe("2026-11-05");
    const paid = calculateFinance(
      settings(),
      [
        transaction({
          amount: 30_000,
          fixedCostId: "rent",
          fixedPeriod: "2026-11",
        }),
      ],
      [fixedCost({ day: 5 })],
      "2026-11-24",
    );
    expect(paid.fixedCostsTotal).toBe(0);
    expect(paid.currentBalance).toBe(70_000);
  });

  it("excludes a fixed bill on the next payday from the current interval", () => {
    const result = calculateFinance(
      settings(),
      [],
      [fixedCost({ day: 25 })],
      "2026-11-24",
    );
    expect(result.fixedCostsTotal).toBe(0);
  });

  it("clamps salary and bill days to February, including leap years", () => {
    const february = calculateFinance(
      settings({ payday: 31, balanceDate: "2027-02-01" }),
      [],
      [fixedCost({ day: 29 })],
      "2027-02-27",
    );
    expect(february.nextPayday).toBe("2027-02-28");
    expect(february.daysRemaining).toBe(1);
    const leap = calculateFinance(
      settings({ payday: 31, balanceDate: "2028-02-01" }),
      [],
      [],
      "2028-02-28",
    );
    expect(leap.nextPayday).toBe("2028-02-29");
  });

  it("crosses a year boundary without negative days", () => {
    const result = calculateFinance(
      settings({ payday: 1, balanceDate: "2026-12-01" }),
      [],
      [],
      "2026-12-31",
    );
    expect(result.nextPayday).toBe("2027-01-01");
    expect(result.daysRemaining).toBe(1);
  });

  it("caps daily funds with the remaining monthly budget and rounds down", () => {
    const result = calculateFinance(
      settings({ monthlyBudget: 10_000 }),
      [transaction({ amount: 6_001 })],
      [],
      "2026-11-23",
    );
    // The transaction is tomorrow, so it cannot consume today's budget.
    expect(result.monthlyRemaining).toBe(10_000);
    expect(result.dailyAllowance).toBe(5_000);
    const todayResult = calculateFinance(
      settings({ monthlyBudget: 10_000 }),
      [transaction({ amount: 6_001, date: "2026-11-23" })],
      [],
      "2026-11-23",
    );
    expect(todayResult.monthlyRemaining).toBe(3_999);
    expect(todayResult.dailyAllowance).toBe(1_999);
  });

  it("reports overspending separately while available amount stays zero", () => {
    const result = calculateFinance(
      settings({ balance: 1_000, monthlyBudget: 500, savings: 100 }),
      [transaction({ amount: 2_000 })],
      [],
      "2026-11-24",
    );
    expect(result.currentBalance).toBe(-1_000);
    expect(result.dailyAllowance).toBe(0);
    expect(result.shortage).toBe(1_100);
    expect(result.budgetExceeded).toBe(1_500);
    expect(result.budgetUsage).toBe(400);
  });

  it("treats zero budget as not configured", () => {
    const result = calculateFinance(
      settings({ monthlyBudget: 0 }),
      [],
      [],
      "2026-11-24",
    );
    expect(result.monthlyRemaining).toBe(0);
    expect(result.dailyAllowance).toBe(100_000);
    expect(result.budgetUsage).toBe(0);
  });

  it("keeps past monthly/category totals separate and excludes tombstones", () => {
    const removed = transaction({ amount: 999_999 });
    removed.deleted = true;
    const result = calculateFinance(
      settings(),
      [
        transaction({ amount: 1_000, category: "食費" }),
        transaction({ amount: 3_000, category: "交通費" }),
        transaction({ amount: 2_000, category: "食費" }),
        transaction({ amount: 500, date: "2026-10-01" }),
        transaction({ type: "income", amount: 20_000 }),
        removed,
      ],
      [{ ...fixedCost(), deleted: true }],
      "2026-11-24",
    );
    expect(result.categoryTotals).toEqual({ 食費: 3_000, 交通費: 3_000 });
    expect(result.monthlyTotals).toEqual({
      "2026-11": { expense: 6_000, income: 20_000 },
      "2026-10": { expense: 500, income: 0 },
    });
    expect(result.fixedCostsTotal).toBe(0);
  });

  it("rejects fractional yen, invalid dates and unsafe arithmetic", () => {
    expect(() =>
      calculateFinance(settings({ balance: 1.5 }), [], [], "2026-11-24"),
    ).toThrow();
    expect(() => calculateFinance(settings(), [], [], "2026-02-30")).toThrow();
    expect(() =>
      calculateFinance(
        settings({ balance: Number.MAX_SAFE_INTEGER }),
        [transaction({ type: "income", amount: 1 })],
        [],
        "2026-11-24",
      ),
    ).toThrow();
  });

  it("formats yen as an integer", () => {
    expect(money(1_234)).toBe("1,234円");
  });
});
