# Redis Persistence MCP Server

This MCP server exposes the 8 atomic Persistence capabilities in `../create-persistence.js` as JSON-callable tools for AI agents.

Browser-backed tools (enable-nonssl / enable-persistence) attach to an existing Edge/Chromium session via CDP. Start Edge with `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` and sign in to the Azure Portal first.

## Run

```powershell
node .\skills\redis-persistence\mcp\server.js
```

Optional environment variables:

```powershell
$env:CDP_ENDPOINT="http://127.0.0.1:9222"
$env:REDIS_TOOLS_DIR="D:\Claude-Redis\tools\redis"
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "redis-persistence": {
      "command": "node",
      "args": ["d:\\junru\\skills\\redis-persistence\\mcp\\server.js"],
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
| 1 prereq | `pers_assert_env` | ARM + local exe presence. |
| 2 provision caches | `pers_provision_caches` | ARM PUT, API 2024-03-01. |
| 3 provision storage | `pers_provision_storage` | ARM. |
| 4 enable non-SSL | `pers_enable_nonssl_ui` | UI. |
| 4 enable non-SSL | `pers_enable_nonssl_arm` | ARM fallback. |
| 4 enable non-SSL | `pers_assert_nonssl_enabled` | ARM polling. |
| 5 enable persistence | `pers_enable_persistence_ui` | UI (AOF or RDB). |
| 5 enable persistence | `pers_wait_ready` | ARM polling. |
| 6 populate | `pers_populate` | redis-benchmark. |
| 7 verify blob | `pers_assert_blob` | ARM (storage blob list). |
| 8 teardown | `pers_teardown` | ARM. |
| — | `pers_portal_status` | List CDP pages. |

UI-backed tools accept `cdpEndpoint` and `pageUrlContains` to pick a specific Portal tab.

## Example Calls

```json
{
  "name": "pers_assert_env",
  "arguments": {
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song"
  }
}
```

```json
{
  "name": "pers_provision_caches",
  "arguments": {
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song",
    "caches": [
      { "name": "ManualTest-9484-CUSE-0527",  "location": "centraluseuap" },
      { "name": "ManualTest-9484-EUS2E-0527", "location": "eastus2euap"   }
    ]
  }
}
```

```json
{
  "name": "pers_enable_persistence_ui",
  "arguments": {
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song",
    "cache":          "ManualTest-9484-CUSE-0527",
    "mode":           "AOF",
    "storageAccount": "manualtest9484sa0527"
  }
}
```

```json
{
  "name": "pers_assert_blob",
  "arguments": {
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song",
    "storageAccount":"manualtest9484sa0527",
    "cache":         "ManualTest-9484-CUSE-0527",
    "pattern":       "aof"
  }
}
```

The MCP layer does not accept Playwright `page` or `ElementHandle` objects. Browser handles live inside the server process; clients pass only serializable JSON inputs.
