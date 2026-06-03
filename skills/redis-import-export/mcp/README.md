# Redis Import / Export MCP Server

This MCP server exposes the 8 atomic Import/Export capabilities in
`../create-import-export.js` as JSON-callable tools for AI agents.

Browser-backed tools (`ie_enable_nonssl_ui` / `ie_portal_export` /
`ie_portal_import`) attach to an existing Edge/Chromium session via CDP.
Start Edge with `--remote-debugging-port=9222
--user-data-dir=%USERPROFILE%\edge-cdp-profile` and sign in to the Azure
Portal first.

## Run

```powershell
node .\skills\redis-import-export\mcp\server.js
```

Optional environment variables:

```powershell
$env:CDP_ENDPOINT="http://127.0.0.1:9222"
$env:AZ_CMD="C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$env:REDIS_CLI="D:\Claude-Redis\tools\redis\redis-cli.exe"
$env:REDIS_BENCHMARK="D:\Claude-Redis\tools\redis\redis-benchmark.exe"
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "redis-import-export": {
      "command": "node",
      "args": ["d:\\junru\\skills\\redis-import-export\\mcp\\server.js"],
      "env": {
        "CDP_ENDPOINT": "http://127.0.0.1:9222"
      }
    }
  }
}
```

## Tools

| Capability | Tool | Notes |
| --- | --- | --- |
| 1 prereq | `ie_assert_env` | ARM + tooling. |
| 2 provision | `ie_provision_storage` | ARM. |
| 2 provision | `ie_assert_storage` | Same-region + container exists. |
| 3 enable non-ssl | `ie_enable_nonssl_ui` | UI (Advanced settings blade). |
| 3 enable non-ssl | `ie_enable_nonssl_arm` | ARM fallback. |
| 3 enable non-ssl | `ie_assert_nonssl_enabled` | ARM polling. |
| 4 populate | `ie_populate` | redis-benchmark + dbsize-pre-export.txt. |
| 5 portal export | `ie_portal_export` | UI (Export data blade). |
| 5 portal export | `ie_assert_export_blobs` | Storage blob polling. |
| 6 flushall | `ie_flushall` | redis-cli + dbsize-post-flush.txt. |
| 7 portal import | `ie_portal_import` | UI (Import data blade). |
| 7 portal import | `ie_assert_import_restored` | DBSIZE recovery + SCAN sample + dbsize-post-import.txt. |
| 8 teardown | `ie_teardown` | ARM (close 6379, purge blobs). |
| — | `ie_portal_status` | List CDP pages. |

UI-backed tools accept `cdpEndpoint` and `pageUrlContains` to pick a specific
Portal tab.

## Example Calls

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "ie_assert_env",
              "arguments": { "subscription": "<sub>", "resourceGroup": "<rg>", "cache": "<cache>" } } }
```

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "ie_portal_export",
              "arguments": { "rid": "/subscriptions/.../Microsoft.Cache/Redis/<cache>",
                             "saName": "<sa>", "container": "redisexports",
                             "prefix": "<cache>-portal-0601" } } }
```
