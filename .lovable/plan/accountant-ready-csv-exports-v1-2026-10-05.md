# Accountant-Ready CSV Exports (v1)

Read-only exports for owners and accountants. No changes to the database, no SQL to run, and no new server endpoints. Only owners and the Supa Admin can see the page. Data is read through the existing signed-in connection, so the business's existing access rules still decide what each person can see.

## What the owner gets
- A new **Accountant exports** page, with a link on Home that only owners see.
- Date presets: Today, Yesterday, This week, Last week, This month, Last month, Custom. All days run in Nigeria time.
- Eight report cards. Each card shows a short description, the number of rows found, and a **Download CSV** button:
  1. Sales Day Book
  2. Cash Drawer Summary
  3. Cash Paid-Out Register
  4. Supplier Ledger (with ageing columns)
  5. Customer Ledger (with ageing columns)
  6. Refund & Reversal Register
  7. Wastage Log
  8. Batch Production
- **Download all** saves each report one after another, then a `manifest.csv` cover sheet. The cover sheet lists the report name, version, when it was made and by whom, the date range, the row count and a checksum.
- If a report has no rows for the dates chosen, the page says "No records found", and the file still downloads with its headers.
- If a report fails to load, the page shows a plain message. The technical details are logged only to the browser console.
- A short **Help for accountants** section on the same page. It explains each report, gives a glossary (void, refund, reversal, late entry, cost confidence) and shows how to open the files in Excel.

## Corrections to match NairaPlate's real records
- **Branches:** NairaPlate has no branches, so there are no branch columns. File names use `branch-all`.
- **Customer Ledger:** customers are grouped from manual credits and credit sales. Repayments and reversals come from the credit payments records. Write-offs only appear if the credit records already hold them; nothing new is invented.
- **Cash Drawer Summary:**
  - `discrepancy_explanation` is filled from the existing close reason. No new field is added.
  - `is_owner_closed` comes from the existing "forced" flag.
  - `shift_number` counts shifts by opening time within each Nigeria day.
- **Sales Day Book:**
  - `cost_confidence` comes from the stored food-cost label on each sale:
    - exact = high
    - backfilled = medium
    - estimated or held = low
    - till sales with a locked-in cost = snapshot
  - Costs are never worked out again.
- **Batch Production:** `cost_source` is `snapshot` because batch costs are locked in when the batch is logged.
- **Refund & Reversal Register:**
  - Each event gets `reversed_module` and `reversed_record_id`.
  - Partial refunds also get `remaining_refundable_naira`.
- **Amounts:** naira columns are plain decimal numbers such as `1450.00`, with no ₦ sign and no commas. Each one has a matching kobo column for checking.
- **Dates:** Nigeria date and time columns, plus the original UTC timestamp for audit.

## File names
`nairaplate_<report>_YYYY-MM-DD_to_YYYY-MM-DD_branch-all.csv`

## Build order
1. **CSV basics:** correctly quoted CSV text with the marker Excel needs to read special characters. Also: Nigeria date helpers, kobo-to-naira conversion, the column list and version for each report (for example `sales_day_book_v1`), the checksum, and the download step.
2. **Report readers:** one typed reader per report, reading only the business's own records, in date windows. Each reader is checked against the column names listed in the code's database types before it is written.
3. **Exports page** and the owner-only link on Home.
4. **Tests:** quoting, kobo-to-naira accuracy, Nigeria day boundaries, column order matching the stored lists, empty results, ageing buckets and checksums. Then a typecheck, the full test run, and a check on the preview that compares the exported totals with the Report and Drawer pages.

## Technical details
- New files:
  - `src/lib/csv-export.ts` and its tests
  - `src/lib/accountant-reports.ts` and its tests
  - `src/routes/exports.tsx`
- Edited file: `src/routes/app.tsx` (the Home link).
- Uses the existing external database connection. `file-saver` is used if it is already installed; otherwise the download uses the browser's own Blob support.
- One rule is added to AGENTS.md: exports are read-only, owner-gated, and use versioned column lists.
- Not included: ZIP bundling, PDF documentation, and accounting-software import formats.
