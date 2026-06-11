---
name: redis-benchmark-report-xlsx
description: |
  Convert a Memtier benchmark "Performance结果.txt" into a weekly Redis
  performance xlsx report that matches the published 20260515-SSL layout
  (3 detail tables + 4 trend blocks + 12 LineCharts). The canonical Python
  generator lives in `../../../tools/`; `report.js` scaffolds / runs / verifies
  it, and `mcp/server.js` exposes those steps as callable MCP tools.
applyTo: "**"
---

# Redis Benchmark Report (txt → xlsx)

Use this skill when the user hands over a Memtier benchmark result txt and asks for "the weekly performance xlsx / 那份表格 / 0515 那种表格". Do **NOT** `shutil.copyfile` an existing xlsx — regenerate from the txt.

## When to use

- User provides a path to a txt like `Performance结果.txt` (one JSON block per cache run).
- User asks for "the table / 表格 / xlsx" in the style of `tools/0515.xlsx`.
- User asks to add a new week's column to the historical trend.

## Required input

A single text file containing repeated blocks of the form:

```
Results from: results-<CID>-<MMDD>.json
... preamble (ignored) ...
{
  "Gets RPS":  <num>,
  "Total duration": <num>,
  "Gets p50.00":  <num>,
  "Gets p99.00":  <num>,
  "Gets p99.90": <num>,
  "Gets p99.99": <num>,
  ...
}
```

Cache id (`CID`) prefixes:
- `P1`–`P5` → Premium (5 caches)
- `SC0`–`SC6` → Standard (7 caches)
- `BC0`–`BC6` → Basic (7 caches)

Total = 19 blocks. `MMDD` may differ per cache (e.g. some 0513, some 0514) — that's expected and the parser must preserve each cache's own `MMDD` into the cache-name column.

## Reference implementation

The canonical generator lives at:

```
d:\Claude-Redis\tools\gen_0515_sheet.py
```

Copy it to `tools/gen_<MMDD>_sheet.py` for the new run and tweak `TXT`, `OUT`, `REPORT_DATE`, `WEEK_LABELS`, and `ORIG_XLSX` (the previous week's xlsx, used to backfill historical columns).

## Output layout (must match 1:1)

Sheet name: `<MMDD>` (e.g. `0515`). 140 rows × 32 cols, 6 merged cells, 12 LineCharts.

**Detail tables** (Calibri 11, header fill `#D9E2F3`, bold cols 1–5, borders `#BFBFBF`):
- Premium: header row 2, data rows 3–7
- Standard: header row 11, data rows 12–18
- Basic: header row 22, data rows 23–29

Columns: `Goal | Cache Region | Cache name | Test Type | Date | Command | Clients | Threads | Clients Memtier | Requests | Size (bytes) | Pipeline | RPS Median | Total duration(ms) | 50% (ms) | 99% (ms) | 99.9% (ms) | 99.99% (ms) | run Times`

Number formats: col 5 `d-mmm`, col 9 `0`, col 13 `0,"K"`, col 14 `0`.

Per-SKU params (`params(cid)`):
- Premium: clients 64, threads 16, memtier 1, requests `1M`, size 1024, pipeline 20
- SC0/SC1/Basic: clients 16, threads 16, memtier 1, requests `1M`, size 1024, pipeline 10
- SC2–SC6: clients 32, threads 16, memtier 1, requests `1M`, size 1024, pipeline 10

Cache name format:
- `P*` → `Verifyperformance-{cid}-EUS2E-{mmdd}`
- `SC*` → `Verifyperformance-{cid[1:]}-EUS2E-Standard-{mmdd}`
- `BC*` → `Verifyperformance-{cid[1:]}-EUS2E-Basic-{mmdd}`

**Trend area** (等线 11, except RPS data cells which use Calibri 11):

| metric | title row | hdr row | AZ row | data rows |
|---|---|---|---|---|
| RPS  | 60 | 61 | 62 | 63–66 |
| p50  | 85 | 86 | 87 | 88–91 |
| p99  | 109 | 110 | 111 | 112–115 |
| p99.9| 134 | 135 | 136 | 137–140 |

Per SKU within each block:
- Premium: label col 1, data cols 2–6, labels `P1`–`P5`
- Standard: label col 11, data cols 12–18, labels `SC0`–`SC6`
- Basic: label col 25, data cols 26–32, labels `BC0`–`BC6`  ← **note 25/26, not 26/27**

AZ note `Availability zones：Allocate zones automatically` is written only for Premium (col 1) and Standard (col 11); Basic's AZ row stays blank.

Week labels: `SSL-EUS2E-0417`, `SSL-EUS2E-0428`, `SSL-EUS2E-0508`, `SSL-EUS2E-<NEW_MMDD>`. Historical 3 weeks are backfilled by reading the previous week's xlsx (`ORIG_XLSX`) at the same `(row, col)`. New week's row is filled from the parsed txt.

Trend value formats: RPS `0,"K"`, latencies `0` (integer).

**12 LineCharts** (RPS / p50 / p99 / p999 × Premium / Standard / Basic):

Anchors:
- RPS:  `A69 / J69 / W69`
- p50:  `A94 / J94 / W94`
- p99:  `A118 / J118 / W118`
- p999: `A143 / J143 / W143`

Per-chart settings (critical, all required to match the reference look):
- `chart.height = 7`, `chart.width = 25`
- Build series explicitly with `SeriesFactory(values_ref, title=label, title_from_data=False)` — one per cache column; **do NOT pass a multi-column Reference** (it includes the AZ separator row and shifts data right by one).
- Categories: `Reference(min_col=label_col, min_row=data_first, max_row=data_first+3)` (4 rows only).
- `series.smooth = False` for every series.
- `DataLabelList(showVal=True, showSerName=False, showCatName=False, showLegendKey=False, showPercent=False, showBubbleSize=False, numFmt=val_fmt)` with `dlbls.position = 't'`.
- `chart.x_axis.delete = False`, `chart.y_axis.delete = False`, `chart.y_axis.number_format = val_fmt`.
- Axis titles via the `_axis_title()` helper (RichText with `RichTextProperties(rot=-5400000)` for vertical Y axis). Assigning a plain string causes Excel to stack the Y-axis title as single letters.
- `chart.x_axis.tickLblPos = 'low'` so X-axis tick labels sit at the bottom and the X-title `Cache Sku` ends up underneath them.
- `chart.y_axis.majorGridlines = ChartLines(spPr=GraphicalProperties(ln=LineProperties(solidFill='D9D9D9', w=6350)))` — light gray gridlines, NOT the openpyxl default dark gray.
- `chart.title.overlay = False`.

Chart titles:
- RPS → `Premium/Standard/Basic Cache RPS：` (full-width colon)
- Latency → `<SKU> Cache <X>% Latency` (`<X>` ∈ `50`, `99`, `99.9`)

Column widths (key columns): `1:27.75, 2:19.875, 3:43.75, 4:13.25, 5:12.875, 6:11.375, 7:9, 8:9, 9:14, 10:10, 11:29.125, 12:9, 13:12.875, 14:16, 15:10, 16:10, 17:11, 18:12, 19:10, 25:36.875, 26:11`.

## Workflow

The new xlsx accumulates history as a multi-sheet book. Each trend-block week label must have a matching sheet; sheet names are short MMDD (e.g. `0428`, `0508`, `0515`, `0520`) to match the trend block. The newest sheet is inserted at index 0 (left-most tab).

For the first run that introduces multi-sheet history, bootstrap from the published 5-week report `performance_result_0515.xlsx` (which uses long names like `20260515-SSL`); rename surviving sheets to short MMDD and drop weeks outside the current 4-week window. Subsequent weeks just load the previous week's xlsx (already short-named) and roll the window.

1. Confirm the txt path (default: `tools/Performance结果.txt`) and target xlsx path (`tools/<MMDD>.xlsx`).
2. Confirm the new `MMDD` and the 3 historical dates (`KEEP_DATES`) shown in the trend block.
3. Confirm the source xlsx: `performance_result_0515.xlsx` for the bootstrap run, otherwise the previous week's xlsx.
4. Copy `tools/gen_0520_sheet.py` → `tools/gen_<MMDD>_sheet.py`, edit:
   - `TXT`, `OUT`
   - `ORIG_XLSX`, `THIS_MMDD`, `KEEP_DATES`
   - Sheet-name normalization regex (only needed when loading from the long-named published report; can be skipped when loading from an already-short-named xlsx)
   - `ws = wb.create_sheet(THIS_MMDD, 0)` keeps "newest first"
   - `REPORT_DATE = datetime.datetime(YYYY, M, D)`
   - `WEEK_LABELS = ['SSL-EUS2E-<d1>', 'SSL-EUS2E-<d2>', 'SSL-EUS2E-<d3>', 'SSL-EUS2E-<MMDD>']` matching `KEEP_DATES + [THIS_MMDD]`
   - Historical backfill row mapping: `orig_row = data_first + wi + 1` (because WEEK_LABELS is shifted left by 1 vs the 0515 report)
   - Trailing sanity check: `ws2 = wb2[THIS_MMDD]`
5. Run `python tools/gen_<MMDD>_sheet.py`.
6. Sanity-check output: `sheets:` list must equal `[THIS_MMDD] + KEEP_DATES` (newest first); new sheet should be `140 × 32 / 6 merged / 12 charts`.
7. Open the xlsx and visually verify:
   - 4 sheet tabs in newest-first order, names match trend-block MMDDs.
   - The previous sheets are unchanged.
   - New sheet: 3 detail tables, merged A/B columns.
   - Trend block: new column on the right, prior 3 weeks unchanged.
   - 12 charts: 4 data points per series, value labels above points, light-gray gridlines, Y-axis title vertical, X-axis title at the bottom under tick labels.

## Common pitfalls (already burned in the reference impl)

- Don't `shutil.copyfile` the previous xlsx — regenerate from txt.
- Don't write a single multi-column `Reference` as series values; use `SeriesFactory` per column or the AZ-row sneaks in as data.
- Don't assign `chart.x_axis.title = "Cache Sku"` directly — use `_axis_title('Cache Sku', vertical=False)` so axis title rendering matches Excel's native behavior; same for Y-axis with `vertical=True`.
- Basic data columns are 25/26, NOT 26/27 — that off-by-one shifts the whole Basic block right.
- AZ row is blank for Basic only. Premium and Standard write the note.
- Default openpyxl chart gridlines are dark; explicitly set them to `#D9D9D9`.
- File-locked errors on save mean Excel still has the xlsx open — ask the user to close it before re-running.
- When rolling the 4-week window (shifting `WEEK_LABELS` left by one), remember to also bump the historical-row lookup to `data_first + wi + 1`. The trailing sanity-check `ws2 = wb2['<MMDD>']` likewise needs the new sheet name.
- After `load_workbook(ORIG_XLSX)` for the multi-sheet bootstrap, **strip charts and images from every inherited sheet** (`s._charts = []; s._images = []`). Mixing the source workbook's legacy chart parts with newly-added openpyxl charts in the same package causes Excel to render every chart as a locked / "禁止" cursor object that can't be edited. Historical sheets keep their data; only the new sheet carries charts.
