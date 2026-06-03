"use strict";

// Firewall MCP — thin adapter over ../firewall-lib.js.
// Each tool is a 1:1 wrapper around a capability helper, with optional
// (subscription, resourceGroup, cache) overrides so the tool set is not
// pinned to a single cache. CDP endpoint follows CDP_ENDPOINT env var.

const fw = require("../firewall-lib");
const session = require("./browser-session");

function s(description) { return { type: "string", description }; }
function n(description) { return { type: "number", description }; }
function b(description) { return { type: "boolean", description }; }
function obj(properties, required = []) {
  return { type: "object", properties, required };
}

function commonProps(extra = {}) {
  return {
    cdpEndpoint: s("Optional CDP endpoint. Defaults to CDP_ENDPOINT or http://127.0.0.1:9222."),
    subscription: s("Optional subscription GUID. Defaults to the constant baked into firewall-lib."),
    resourceGroup: s("Optional resource group. Defaults to the constant baked into firewall-lib."),
    cache: s("Optional cache name. Defaults to the constant baked into firewall-lib."),
    tenant: s("Optional tenant. Default microsoft.onmicrosoft.com."),
    ...extra,
  };
}

function buildFwUrl(args) {
  const sub = args.subscription || fw.SUB;
  const rg = args.resourceGroup || fw.RG;
  const cache = args.cache || fw.CACHE;
  const tenant = args.tenant || "microsoft.onmicrosoft.com";
  const armId = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}`;
  return {
    sub, rg, cache, tenant, armId,
    fwUrl: `https://ms.portal.azure.com/?l=en.en-us#@${tenant}/resource${armId}/firewallRules`,
  };
}

// Resolve a Portal page already on the firewall blade (or navigate it there),
// then attach lib via getFwFrame.
async function withFrame(args, fn) {
  const { fwUrl } = buildFwUrl(args);
  const page = await session.getPortalPage({ ...args, pageUrlContains: args.pageUrlContains || "ms.portal.azure.com" });
  if (!page.url().toLowerCase().includes("firewallrules")) {
    await page.goto(fwUrl, { waitUntil: "load" });
  }
  await fw.reloadBlade(page);
  const frame = await fw.getFwFrame(page, 90000);
  return fn(page, frame);
}

// Same but no reloadBlade (caller wants to inspect dirty state, e.g. trash + Save flow).
async function withFrameDirty(args, fn) {
  const { fwUrl } = buildFwUrl(args);
  const page = await session.getPortalPage({ ...args, pageUrlContains: args.pageUrlContains || "ms.portal.azure.com" });
  if (!page.url().toLowerCase().includes("firewallrules")) {
    await page.goto(fwUrl, { waitUntil: "load" });
  }
  const frame = await fw.getFwFrame(page, 90000);
  return fn(page, frame);
}

// ARM helpers — currently bound to lib constants. For overrides we shell out to az rest directly.
const cp = require("child_process");
function azRestList(args) {
  const { sub, rg, cache } = buildFwUrl(args);
  const uri = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/firewallRules?api-version=2024-11-01`;
  const out = cp.execSync(`az rest --method get --uri "${uri}"`, { encoding: "utf8" });
  const data = JSON.parse(out);
  return (data.value || []).map(r => ({
    name: (r.name || "").split("/").pop(),
    start: r.properties && r.properties.startIP,
    end: r.properties && r.properties.endIP,
  }));
}
function azRestPut(args) {
  const { sub, rg, cache } = buildFwUrl(args);
  const body = JSON.stringify({ properties: { startIP: args.start, endIP: args.end } });
  const uri = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/firewallRules/${args.name}?api-version=2024-11-01`;
  cp.execSync(`az rest --method put --uri "${uri}" --headers "Content-Type=application/json" --body '${body.replace(/'/g, "''")}'`, { encoding: "utf8", shell: "powershell.exe" });
  return { ok: true, name: args.name };
}
function azRestDelete(args) {
  const { sub, rg, cache } = buildFwUrl(args);
  const uri = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/firewallRules/${args.name}?api-version=2024-11-01`;
  cp.execSync(`az rest --method delete --uri "${uri}"`, { encoding: "utf8" });
  return { ok: true, name: args.name };
}
function azRestDeleteAll(args) {
  const list = azRestList(args);
  for (const r of list) azRestDelete({ ...args, name: r.name });
  return { deleted: list.map(r => r.name) };
}

const tools = [
  // ── Capability 1+2: prereq + open blade ─────────────────────────
  {
    name: "fw_open_blade",
    description: "Connect via CDP, navigate to the Firewall blade, reload it cleanly, return the toolbar baseline state.",
    inputSchema: obj(commonProps()),
  },
  {
    name: "fw_portal_status",
    description: "List CDP-connected browser pages and identify Azure Portal tabs (smoke-test the CDP endpoint).",
    inputSchema: obj({ cdpEndpoint: s("Optional CDP endpoint. Defaults to CDP_ENDPOINT or http://127.0.0.1:9222.") }),
  },

  // ── Capability 3: toolbar ────────────────────────────────────────
  {
    name: "fw_toolbar_state",
    description: "Read current toolbar Save/Discard/Add disabled state. Reloads the blade first (clean read).",
    inputSchema: obj(commonProps()),
  },
  {
    name: "fw_save",
    description: "Click toolbar Save and wait for it to disable again (i.e. ARM commit complete on the UI side).",
    inputSchema: obj(commonProps({ timeoutMs: n("Wait deadline. Default 60000.") })),
  },

  // ── Capability 4: add via dialog ────────────────────────────────
  {
    name: "fw_add_rule",
    description: "Open the Add dialog, fill (name,start,end), click Ok. Returns the dialog Ok result string.",
    inputSchema: obj(commonProps({
      name: s("New rule name (a-zA-Z0-9_, ≤ 40 chars)."),
      start: s("Start IP."),
      end: s("End IP."),
      save: b("If true, also clickToolbar('Save') and waitSaveDisabledAgain. Default false."),
    }), ["name", "start", "end"]),
  },
  {
    name: "fw_field_errors",
    description: "Read field-level validation errors visible in the current Add/edit form (use after fw_add_rule reports timeout-disabled).",
    inputSchema: obj(commonProps()),
  },

  // ── Capability 5: inline edit ────────────────────────────────────
  {
    name: "fw_inline_edit_ip",
    description: "Inline-edit a persisted rule's IP (col 0 = startIP, col 1 = endIP). Note: when widening a range, edit End first; narrowing, Start first.",
    inputSchema: obj(commonProps({
      ruleName: s("Persisted rule name (leaf-text match)."),
      colIndex: n("0 for Start IP, 1 for End IP."),
      newValue: s("New IP value."),
      save: b("If true, also Save + wait. Default false."),
    }), ["ruleName", "colIndex", "newValue"]),
  },

  // ── Capability 6: discard ────────────────────────────────────────
  {
    name: "fw_discard",
    description: "Click toolbar Discard, confirm 'Yes' on the Unsaved Changes dialog, wait for clean toolbar.",
    inputSchema: obj(commonProps({ timeoutMs: n("Default 15000.") })),
  },

  // ── Capability 7+10: row inspect, trash, banner ─────────────────
  {
    name: "fw_visible_rules",
    description: "List currently visible rule names in the grid (works for both saved and unsaved rows).",
    inputSchema: obj(commonProps()),
  },
  {
    name: "fw_click_trash",
    description: "Click the per-row trash icon for a single rule. Caller is responsible for fw_save afterwards.",
    inputSchema: obj(commonProps({ ruleName: s("Rule name to delete (leaf-text match).") }), ["ruleName"]),
  },
  {
    name: "fw_banner_texts",
    description: "Read visible banner texts (used to detect the 20-op quota banner: 'Maximum 20 rules can be edited at once.').",
    inputSchema: obj(commonProps()),
  },
  {
    name: "fw_screenshot",
    description: "Capture a screenshot of the current Portal page (after a clean reload of the firewall blade).",
    inputSchema: obj(commonProps({ path: s("Output PNG path. Required.") }), ["path"]),
  },

  // ── Capability 8: ARM fallback / verify ─────────────────────────
  {
    name: "fw_arm_list",
    description: "GET firewallRules via az rest. Returns [{name, start, end}].",
    inputSchema: obj(commonProps()),
  },
  {
    name: "fw_arm_put",
    description: "PUT firewallRules/<name> via az rest. Use to seed test state outside the UI.",
    inputSchema: obj(commonProps({ name: s("Rule name."), start: s("Start IP."), end: s("End IP.") }), ["name", "start", "end"]),
  },
  {
    name: "fw_arm_delete",
    description: "DELETE firewallRules/<name> via az rest.",
    inputSchema: obj(commonProps({ name: s("Rule name.") }), ["name"]),
  },
  {
    name: "fw_arm_delete_all",
    description: "Delete every firewallRule on the cache via az rest. Use as Stage-7 ARM-fast cleanup.",
    inputSchema: obj(commonProps()),
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "fw_portal_status":
      return { pages: await session.listPages(args) };

    case "fw_open_blade":
      return withFrame(args, async (_p, f) => ({ toolbar: await fw.getToolbarStates(f) }));

    case "fw_toolbar_state":
      return withFrame(args, async (_p, f) => ({ toolbar: await fw.getToolbarStates(f) }));

    case "fw_save":
      return withFrameDirty(args, async (_p, f) => {
        await fw.clickToolbar(f, "Save");
        const saved = await fw.waitSaveDisabledAgain(f, args.timeoutMs || 60000);
        return { saved };
      });

    case "fw_add_rule":
      return withFrame(args, async (_p, f) => {
        await fw.clickToolbar(f, "Add");
        await new Promise(r => setTimeout(r, 1500));
        await fw.fillNewRule(f, { name: args.name, startIP: args.start, endIP: args.end });
        await new Promise(r => setTimeout(r, 600));
        const okResult = await fw.clickDialogOk(f, 8000);
        let saved;
        if (args.save && okResult === "ok") {
          await fw.clickToolbar(f, "Save");
          saved = await fw.waitSaveDisabledAgain(f, 60000);
        }
        return { ok: okResult, saved };
      });

    case "fw_field_errors":
      return withFrameDirty(args, async (_p, f) => ({ errors: await fw.getFieldErrors(f) }));

    case "fw_inline_edit_ip":
      return withFrame(args, async (p, f) => {
        await fw.inlineEditByIndex(p, f, args.ruleName, Number(args.colIndex), String(args.newValue));
        let saved;
        if (args.save) {
          await fw.clickToolbar(f, "Save");
          saved = await fw.waitSaveDisabledAgain(f, 60000);
        }
        return { dirtyToolbar: await fw.getToolbarStates(f), saved };
      });

    case "fw_discard":
      return withFrameDirty(args, async (_p, f) => ({ clean: await fw.discardAndConfirm(f, args.timeoutMs || 15000) }));

    case "fw_visible_rules":
      return withFrame(args, async (_p, f) => ({ rules: await fw.visibleRuleNames(f) }));

    case "fw_click_trash":
      return withFrameDirty(args, async (_p, f) => ({
        result: await fw.clickRowTrash(f, args.ruleName),
        toolbar: await fw.getToolbarStates(f),
      }));

    case "fw_banner_texts":
      return withFrameDirty(args, async (_p, f) => ({ banners: await fw.getBannerTexts(f) }));

    case "fw_screenshot":
      return withFrame(args, async (p) => {
        await p.screenshot({ path: args.path, fullPage: false });
        return { path: args.path };
      });

    case "fw_arm_list":
      return { rules: azRestList(args) };
    case "fw_arm_put":
      return azRestPut(args);
    case "fw_arm_delete":
      return azRestDelete(args);
    case "fw_arm_delete_all":
      return azRestDeleteAll(args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
