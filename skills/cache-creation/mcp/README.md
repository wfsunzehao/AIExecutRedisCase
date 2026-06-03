# Cache Creation MCP Server

This MCP server exposes the Playwright helper functions in `../create-cache.js` as JSON-callable tools for AI agents.

It connects to an existing Edge/Chromium session through CDP. Start Edge with `--remote-debugging-port=9222` and sign in to the Azure Portal before using browser tools.

## Run

```powershell
node .\skills\cache-creation\mcp\server.js
```

Optional environment variable:

```powershell
$env:CDP_ENDPOINT="http://127.0.0.1:9222"
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "cache-creation": {
      "command": "node",
      "args": ["d:\\AItest\\junru\\skills\\cache-creation\\mcp\\server.js"],
      "env": {
        "CDP_ENDPOINT": "http://127.0.0.1:9222"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `cache_portal_status` | List CDP-connected browser pages and identify Azure Portal tabs. |
| `cache_navigate_create_form` | Open the Azure Cache for Redis create form. |
| `cache_visible_dropdowns` | Return visible Portal dropdown indexes and text. |
| `cache_select_dropdown` | Select Subscription, Resource Group, Region, Cache Type, or Cache Size. |
| `cache_choose_public_endpoint` | Select and verify Public endpoint. |
| `cache_select_zones` | Select Availability Zones. |
| `cache_set_toggle` | Set a Portal toggle by exact `aria-label`. |
| `cache_set_number_by_field_label` | Set a numeric slider/input by exact visible field label, such as `Shard count`. |
| `cache_go_next` | Move to the next form tab. |
| `cache_fill_cache_name` | Fill the DNS/name input on the Basics tab. |
| `cache_read_page_text` | Read visible page text for Review/deployment checks. |
| `cache_capture_screenshot` | Capture a screenshot artifact. |
| `cache_click_create` | Click the enabled Create button on Review + create. |
| `cache_click_go_to_resource` | Click Go to resource from the deployment blade. |
| `cache_query_or_create_vnet` | Query or create a VNet via Azure CLI. |

## Example Calls

```json
{
  "name": "cache_select_dropdown",
  "arguments": {
    "dropdown": "region",
    "text": "Central US EUAP"
  }
}
```

```json
{
  "name": "cache_set_toggle",
  "arguments": {
    "ariaLabel": "Access Keys Authentication Enable",
    "wantEnabled": true
  }
}
```

```json
{
  "name": "cache_set_number_by_field_label",
  "arguments": {
    "fieldLabel": "Shard count",
    "value": 2
  }
}
```

The MCP layer does not accept Playwright `page` or `ElementHandle` objects. It keeps those inside the server process and exposes only serializable JSON inputs.