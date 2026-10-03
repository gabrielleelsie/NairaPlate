import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType, PageBreak,
} from "docx";
import { saveAs } from "file-saver";
import { MODULES, UAT_CASES, type DrillMetrics, type StepResult, type StepStatus } from "./uat-data";

const W = 9360;
const border = { style: BorderStyle.SINGLE, size: 4, color: "B8C2CC" };
const borders = { top: border, bottom: border, left: border, right: border };
const STATUS_COLOR: Record<StepStatus, string> = { pass: "1E7B34", fail: "C0262D", blocked: "B26B00", untested: "6B7280" };
const STATUS_FILL: Record<StepStatus, string> = { pass: "E3F4E7", fail: "FBE4E5", blocked: "FFF1D6", untested: "F1F3F5" };

function cell(text: string, width: number, opts: { header?: boolean; status?: StepStatus } = {}) {
  const fill = opts.header ? "0B192C" : opts.status ? STATUS_FILL[opts.status] : undefined;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    ...(fill ? { shading: { fill, type: ShadingType.CLEAR, color: "auto" } } : {}),
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: (text || "—").split("\n").map((line) => new Paragraph({
      children: [new TextRun({
        text: line, size: 18,
        bold: opts.header || !!opts.status,
        ...(opts.header ? { color: "FFFFFF" } : opts.status ? { color: STATUS_COLOR[opts.status] } : {}),
      })],
    })),
  });
}

function kvTable(rows: [string, string][]) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, 2800, { header: true }), cell(v, 6560)] })),
  });
}

const p = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, ...o })] });

export async function exportUatDocx(args: {
  tester: string; date: string; results: Record<string, StepResult[]>; drill: DrillMetrics;
  counts: Record<StepStatus, number>; total: number;
}) {
  const { tester, date, results, drill, counts, total } = args;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: "NairaPlate", bold: true, size: 28, color: "0B7A4B" })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [new TextRun({ text: "NairaPlate - User Acceptance Testing (UAT) Execution Script: Demo Kitchen Owner", bold: true, size: 36 })] }),
    kvTable([
      ["Environment", "Staging / Demo Kitchen"],
      ["Executed By", tester || "—"],
      ["Date", date],
      ["Total Steps", String(total)],
      ["Passed", `${counts.pass} (${pct(counts.pass)})`],
      ["Failed", `${counts.fail} (${pct(counts.fail)})`],
      ["Blocked", `${counts.blocked} (${pct(counts.blocked)})`],
      ["Untested", `${counts.untested} (${pct(counts.untested)})`],
    ]),
  ];

  const cols: [number, number, number, number, number] = [600, 2400, 2400, 2560, 1400];
  for (const tc of UAT_CASES) {
    const res = results[tc.id] ?? [];
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text: `${tc.id} | ${tc.title}`, bold: true, size: 28 })] }),
      p(`Module ${tc.module}: ${MODULES[tc.module]} — ${tc.area}`, { color: "4B5563", size: 20 }),
      p("Pre-conditions: " + tc.preconditions.join(" "), { size: 20 }),
      new Table({
        width: { size: W, type: WidthType.DXA },
        columnWidths: cols,
        rows: [
          new TableRow({ tableHeader: true, children: ["#", "Action", "Expected Result", "Actual Result", "Status"].map((h, i) => cell(h, cols[i]!, { header: true })) }),
          ...tc.steps.map((s, i) => new TableRow({ children: [
            cell(String(i + 1), cols[0]), cell(s.action, cols[1]), cell(s.expected, cols[2]),
            cell(res[i]?.actual ?? "", cols[3]), cell((res[i]?.status ?? "untested").toUpperCase(), cols[4], { status: res[i]?.status ?? "untested" }),
          ] })),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 160 }, children: [new TextRun({ text: "Supabase Restoration & Verification Drill", bold: true, size: 28 })] }),
    kvTable([
      ["Recovery Point (RPO)", drill.rpo],
      ["Recovery Time (RTO)", drill.rto],
      ["Query Results", drill.queryResults],
      ["Drill Outcome", (() => { const r = results["UAT-OWN-06"] ?? []; return r.every((s) => s.status === "pass") ? "PASS" : r.some((s) => s.status === "fail") ? "FAIL" : "INCOMPLETE"; })()],
    ]),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 480, after: 240 }, children: [new TextRun({ text: "Sign-off", bold: true, size: 28 })] }),
  );
  for (const role of ["Quality Assurance Lead", "Kitchen Owner"]) {
    children.push(
      p(role, { bold: true }),
      p("Signature: ________________________________"),
      p("Name: ____________________________________"),
      new Paragraph({ spacing: { after: 360 }, children: [new TextRun("Date: _____________________________________")] }),
    );
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `NairaPlate-UAT-Demo-Kitchen-Owner-${date}.docx`);
}
void AlignmentType;
