import { describe, expect, it } from "vitest";
import { csvEscape, toCsv, koboToNaira, lagosDate, lagosTime, exportFilename, checksum, REPORT_SCHEMAS, daysBetween } from "./csv-export";

describe("csv-export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvEscape('Mama "Put" Rice, Jollof')).toBe('"Mama ""Put"" Rice, Jollof"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape(true)).toBe("TRUE");
    expect(csvEscape(null)).toBe("");
  });
  it("writes BOM, headers in order and CRLF", () => {
    const t = toCsv(["b", "a"], [{ a: 1, b: "x" }]);
    expect(t).toBe("\uFEFFb,a\r\nx,1\r\n");
    expect(toCsv(["a"], [])).toBe("\uFEFFa\r\n");
  });
  it("converts kobo to plain naira", () => {
    expect(koboToNaira(145000)).toBe("1450.00");
    expect(koboToNaira(5)).toBe("0.05");
    expect(koboToNaira(-2550)).toBe("-25.50");
    expect(koboToNaira("250050")).toBe("2500.50");
    expect(koboToNaira(null)).toBe("");
  });
  it("uses Nigeria day boundaries", () => {
    expect(lagosDate("2026-10-04T22:59:59Z")).toBe("2026-10-04");
    expect(lagosDate("2026-10-04T23:00:00Z")).toBe("2026-10-05");
    expect(lagosTime("2026-10-04T23:00:00Z")).toBe("00:00:00");
    expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30);
  });
  it("names files and fingerprints them", () => {
    expect(exportFilename("sales_day_book", "2026-10-01", "2026-10-05")).toBe("nairaplate_sales_day_book_2026-10-01_to_2026-10-05_branch-all.csv");
    expect(checksum("abc")).toBe(checksum("abc"));
    expect(checksum("abc")).not.toBe(checksum("abd"));
  });
  it("keeps versioned column lists with no duplicates", () => {
    for (const [id, s] of Object.entries(REPORT_SCHEMAS)) {
      expect(s.version.startsWith(id)).toBe(true);
      expect(new Set(s.columns).size).toBe(s.columns.length);
    }
    expect(REPORT_SCHEMAS.sales_day_book.columns.slice(0, 3)).toEqual(["lagos_date", "lagos_time", "order_ref"]);
  });
});
