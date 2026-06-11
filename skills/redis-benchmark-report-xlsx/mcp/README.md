# Redis Benchmark Report (xlsx) MCP Server

This MCP server exposes the report-generation steps in [`../report.js`](../report.js)
as JSON-callable tools. The actual xlsx layout is produced by a per-run Python
generator under [`../../../../tools/`](../../../../tools/) (canonical reference:
`gen_0520_sheet.py`); the full layout spec and pitfalls live in
[`../SKILL.md`](../SKILL.md).

Workflow: `report_scaffold` a dated copy of the reference generator → edit its
constants (`TXT` / `OUT` / `REPORT_DATE` / `WEEK_LABELS` / `ORIG_XLSX` /
`KEEP_DATES`) as described in SKILL.md → `report_run` it → `report_verify` the
output dimensions and chart count. Requires Python 3.10+ with `openpyxl`.

## Run

```powershell
node .\Claude-Redis\skills\redis-benchmark-report-xlsx\mcp\server.js
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "redis-benchmark-report-xlsx": {
      "command": "node",
      "args": ["d:\\Claude-Redis\\Claude-Redis\\skills\\redis-benchmark-report-xlsx\\mcp\\server.js"]
    }
  }
}
```

## Tools

| Step | Tool | Notes |
| --- | --- | --- |
| scaffold | `report_scaffold` | Copy reference → `gen_<MMDD>_sheet.py`; never overwrites. |
| run | `report_run` | `python gen_<MMDD>_sheet.py`. |
| verify | `report_verify` | openpyxl: sheets, dims, merged cells, chart count. |

## Example Calls

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "report_scaffold", "arguments": { "thisMmdd": "0608" } } }
```

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "report_verify", "arguments": { "xlsx": "d:\\Claude-Redis\\tools\\0608.xlsx" } } }
```
