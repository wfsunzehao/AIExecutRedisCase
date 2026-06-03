# Firewall Rules Test — MCP Server

Stdio MCP wrapper around [`../firewall-lib.js`](../firewall-lib.js). Exposes
the same atomic capabilities documented in [`../SKILL.md`](../SKILL.md) as
JSON-RPC tools, so other agents can drive the Firewall and virtual network
blade end-to-end without re-implementing Portal-UI clicks.

## Run

```powershell
npm run mcp:firewall-rules-test
```

Or auto-launched by VS Code / Copilot Chat via the entry in
`.vscode/mcp.json` (server id `firewall-rules-test`).

The server reads `CDP_ENDPOINT` (default `http://127.0.0.1:9222`) and
expects an Edge instance launched with the CDP flags described in the
parent `SKILL.md` "Shared Conventions" section.

## Tool surface

Every tool accepts optional `subscription`, `resourceGroup`, `cache`,
`tenant`, and `cdpEndpoint` — when omitted, the constants baked into
`firewall-lib.js` (currently `fwtest-cuse-0602` / `test_song`) are used.

| Tool | Capability | Purpose |
|---|---|---|
| `fw_portal_status` | — | List CDP-attached browser pages (smoke test). |
| `fw_open_blade` | 1 + 2 | Connect, navigate, `reloadBlade`, return clean toolbar. |
| `fw_toolbar_state` | 3 | `getToolbarStates` after a clean reload. |
| `fw_save` | 3 | `clickToolbar('Save')` + `waitSaveDisabledAgain`. |
| `fw_add_rule` | 4 | Open dialog, fill, click Ok; optional `save:true`. |
| `fw_field_errors` | 9 | `getFieldErrors` (use after `Ok=timeout-disabled`). |
| `fw_inline_edit_ip` | 5 | `inlineEditByIndex(p,f,name,col,value)`; optional `save:true`. |
| `fw_discard` | 6 | `discardAndConfirm`. |
| `fw_visible_rules` | 7 | `visibleRuleNames` (covers saved + unsaved rows). |
| `fw_click_trash` | 10 | Per-row trash click; caller calls `fw_save` next. |
| `fw_banner_texts` | 10 | `getBannerTexts` (used to detect the 20-op quota banner). |
| `fw_screenshot` | — | `page.screenshot({ path })`. |
| `fw_arm_list` | 8 | GET `firewallRules` (auto-strips `<cache>/` prefix). |
| `fw_arm_put` | 8 | PUT `firewallRules/<name>`. |
| `fw_arm_delete` | 8 | DELETE `firewallRules/<name>`. |
| `fw_arm_delete_all` | 8 | Delete every rule on the cache (Stage-7 ARM-fast cleanup). |

## Composition examples

**Stage 3 (real-traffic firewalling, fail-fast on baseline mismatch)**

```jsonc
{ "tool": "fw_arm_delete_all" }
{ "tool": "fw_add_rule", "args": { "name": "block_all", "start": "0.0.0.0", "end": "0.0.0.0", "save": true } }
// caller uses redis-cli PING outside MCP and asserts BLOCKED
{ "tool": "fw_inline_edit_ip", "args": { "ruleName": "block_all", "colIndex": 1, "newValue": "255.255.255.255", "save": true } }
// asserts PONG
```

**Stage 6 (20-op quota)**

```jsonc
// 20× fw_add_rule (no save) then:
{ "tool": "fw_banner_texts" }
// expect ["Maximum 20 rules can be edited at once. Please save changes before making more edits.", ...]
{ "tool": "fw_save", "args": { "timeoutMs": 180000 } }
{ "tool": "fw_arm_list" }
// expect length == 20
```

**Stage 7 (UI cleanup respecting quota)**

```jsonc
// Loop until visibleRules is empty:
{ "tool": "fw_visible_rules" }
// for each name in batches of 20: fw_click_trash → fw_save
```
