import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isDateString,
  localDate,
} from "./dates";

describe("local calendar dates", () => {
  it("formats local components, rather than slicing the UTC timestamp", () => {
    const date = new Date(2026, 10, 24, 0, 30);
    expect(localDate(date)).toBe("2026-11-24");
  });
  it("validates leap years and real calendar dates", () => {
    expect(isDateString("2028-02-29")).toBe(true);
    expect(isDateString("2027-02-29")).toBe(false);
    expect(isDateString("2026-04-31")).toBe(false);
    expect(isDateString("2026-00-01")).toBe(false);
    expect(isDateString("2026-1-1")).toBe(false);
    expect(daysInMonth(2028, 1)).toBe(29);
  });
  it("crosses day/month/year boundaries as calendar days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
  it("clamps monthly recurrence at shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-31");
  });
  it("rejects impossible dates in arithmetic", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => daysBetween("invalid", "2026-11-24")).toThrow();
  });
});
