# Geo Replication Setup MCP Server

This MCP server exposes the 8 atomic Geo capabilities in `../create-geo.js` as JSON-callable tools for AI agents.

Browser-backed tools (link / failover / reboot-failover / unlink) attach to an existing Edge/Chromium session via CDP. Start Edge with `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` and sign in to the Azure Portal first.

## Run

```powershell
node .\skills\geo-replication-setup\mcp\server.js
```

Optional environment variable:

```powershell
$env:CDP_ENDPOINT="http://127.0.0.1:9222"
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "geo-replication-setup": {
      "command": "node",
      "args": ["d:\\junru\\skills\\geo-replication-setup\\mcp\\server.js"],
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
| 1 prereq | `geo_assert_env` | ARM only. |
| 2 provision | _(removed)_ | Use the `cache-creation` skill to create the Premium, non-AAD caches. |
| 3 link | `geo_link_ui` | UI. |
| 3 link | `geo_link_arm` | ARM fallback. |
| 3 link | `geo_wait_link` | ARM polling. |
| 3 link | `geo_assert_pair` | ARM. |
| 4 failover | `geo_failover` | UI. |
| 4 failover | `geo_assert_role_flip` | ARM. |
| 4 failover | `geo_test_activity_log` | ARM (Activity Log). |
| 5 reboot-failover | `geo_reboot_failover` | UI. |
| 5 reboot-failover | `geo_assert_concurrent_notifications` | UI. |
| 6 unlink | `geo_unlink` | UI/ARM/Auto. |
| 6 unlink | `geo_assert_unlinked` | ARM polling. |
| 7 dns verify | `geo_test_dns` | DNS over 8.8.8.8. |
| 8 teardown | `geo_teardown` | ARM. |
| — | `geo_portal_status` | List CDP pages. |

UI-backed tools accept `cdpEndpoint` and `pageUrlContains` to pick a specific Portal tab.

## Example Calls

```json
{
  "name": "geo_assert_env",
  "arguments": {
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song"
  }
}
```

```json
{
  "name": "geo_link_ui",
  "arguments": {
    "primary":   "ManualTestingGeo-EUS2E-0527",
    "secondary": "ManualTestingGeo-SEA-0527",
    "subscription": "1e57c478-0901-4c02-8d35-49db234b78d2",
    "resourceGroup": "test_song"
  }
}
```

```json
{
  "name": "geo_test_dns",
  "arguments": {
    "newPrimary":   "ManualTestingGeo-SEA-0527",
    "newSecondary": "ManualTestingGeo-EUS2E-0527"
  }
}
```

The MCP layer does not accept Playwright `page` or `ElementHandle` objects. Browser handles live inside the server process; clients pass only serializable JSON inputs.
