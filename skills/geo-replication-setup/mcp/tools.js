"use strict";

const session = require("./browser-session");
const geo = require("../create-geo");

function s(description) { return { type: "string", description }; }
function n(description) { return { type: "number", description }; }
function b(description) { return { type: "boolean", description }; }
function a(description, itemType = "string") {
  return { type: "array", description, items: { type: itemType } };
}

// Common params auto-injected into every tool schema (for UI tools that resolve a page).
function schema(properties, required = []) {
  return {
    type: "object",
    properties: {
      cdpEndpoint: s("Optional CDP endpoint. Defaults to CDP_ENDPOINT or http://127.0.0.1:9222."),
      pageUrlContains: s("Optional URL substring used to choose a specific open browser tab."),
      ...properties,
    },
    required,
  };
}

// ARM-only schema (no CDP/page params).
function armSchema(properties, required = []) {
  return { type: "object", properties, required };
}

const tools = [
  // ── Capability 1: prereq ──────────────────────────────────────────
  {
    name: "geo_assert_env",
    description: "Capability 1 (geo-prereq): verify az CLI, playwright, subscription/RG access, and CDP Edge on 9222.",
    inputSchema: armSchema({
      subscription: s("Target subscription GUID."),
      resourceGroup: s("Existing resource group."),
      cdpPort: n("CDP port. Default 9222."),
    }, ["subscription", "resourceGroup"]),
  },

  // ── Capability 2 (provision): out of scope — use the cache-creation skill. ──

  // ── Capability 3: link ────────────────────────────────────────────
  {
    name: "geo_link_ui",
    description: "Capability 3 (geo-link, UI path): drive Portal 'Add cache replication link' from primary blade.",
    inputSchema: schema({
      primary: s("Cache that initiates the link (becomes Primary)."),
      secondary: s("Peer cache (becomes Secondary)."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
      screenshotPrefix: s("Optional screenshot file prefix."),
    }, ["primary", "secondary", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_link_arm",
    description: "Capability 3 (geo-link, ARM fallback): PUT linkedServers; auto-retries with pair reversed on 400.",
    inputSchema: armSchema({
      primary: s("Primary cache name."),
      secondary: s("Secondary cache name."),
      secondaryLocation: s("ARM-form location of secondary, e.g. southeastasia."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
    }, ["primary", "secondary", "secondaryLocation", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_wait_link",
    description: "Poll linkedServers across given caches until Succeeded (or until empty when expectEmpty=true).",
    inputSchema: armSchema({
      caches: a("Cache names to poll."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      maxMinutes: n("Polling deadline. Default 60."),
      pollSec: n("Interval. Default 30."),
      expectEmpty: b("When true, wait until every cache reports value:[] (used by unlink)."),
    }, ["caches", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_assert_pair",
    description: "Verify exactly one linkedServers entry per side with correct peer serverRole.",
    inputSchema: armSchema({
      primary: s("Primary cache name."),
      secondary: s("Secondary cache name."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
    }, ["primary", "secondary", "subscription", "resourceGroup"]),
  },

  // ── Capability 4: failover ────────────────────────────────────────
  {
    name: "geo_failover",
    description: "Capability 4 (geo-failover): click Failover on current Geo-Primary from the Portal UI.",
    inputSchema: schema({
      cache: s("Current Geo-Primary cache (failover initiated from its blade)."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
      screenshotPrefix: s("Optional screenshot file prefix."),
    }, ["cache", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_assert_role_flip",
    description: "After failover, verify ARM control plane shows roles flipped.",
    inputSchema: armSchema({
      oldPrimary: s("Cache that WAS Primary."),
      oldSecondary: s("Cache that WAS Secondary."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
    }, ["oldPrimary", "oldSecondary", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_test_activity_log",
    description: "Verify Activity Log linkedservers + Succeeded entry on the new primary's resource.",
    inputSchema: armSchema({
      newPrimary: s("Cache that is now Geo-Primary (was the secondary)."),
      resourceGroup: s("Resource group."),
      subscription: s("Subscription GUID (optional)."),
      offsetMin: n("Lookback window in minutes. Default 30."),
    }, ["newPrimary", "resourceGroup"]),
  },

  // ── Capability 5: reboot-then-failover ────────────────────────────
  {
    name: "geo_reboot_failover",
    description: "Capability 5 (ADO 16021140): reboot primary + failover secondary within <=2s; returns deltaSec.",
    inputSchema: schema({
      primary: s("Current Geo-Primary — receives the reboot."),
      secondary: s("Current Geo-Secondary — receives the failover."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
    }, ["primary", "secondary", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_assert_concurrent_notifications",
    description: "Open Notifications flyout and assert both 'Rebooting cache' and 'Submitting failover request' visible.",
    inputSchema: schema({
      screenshotPath: s("Optional output PNG path."),
    }),
  },

  // ── Capability 6: unlink ──────────────────────────────────────────
  {
    name: "geo_unlink",
    description: "Capability 6 (geo-unlink): Unlink the pair via UI / ARM / Auto.",
    inputSchema: schema({
      caches: a("Exactly 2 cache names: [primary, secondary]."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      mode: s("'UI' | 'Arm' | 'Auto'. Default 'Auto'."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
    }, ["caches", "subscription", "resourceGroup"]),
  },
  {
    name: "geo_assert_unlinked",
    description: "Wait until every cache's linkedServers returns value:[].",
    inputSchema: armSchema({
      caches: a("Cache names to check."),
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      maxMinutes: n("Polling deadline. Default 15."),
    }, ["caches", "subscription", "resourceGroup"]),
  },

  // ── Capability 7: DNS verify ──────────────────────────────────────
  {
    name: "geo_test_dns",
    description: "Capability 7 (ADO 16021106): verify both .geo. CNAMEs resolve to the current Geo-Primary.",
    inputSchema: armSchema({
      newPrimary: s("Cache currently Geo-Primary."),
      newSecondary: s("Cache currently Geo-Secondary."),
      dnsServer: s("External resolver. Default 8.8.8.8."),
    }, ["newPrimary", "newSecondary"]),
  },

  // ── Capability 8: teardown ────────────────────────────────────────
  {
    name: "geo_teardown",
    description: "Capability 8: ARM-unlink then parallel az redis delete --no-wait for the given caches.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      caches: a("Full cache names to tear down. Length should be even (consecutive pairs are unlinked together)."),
    }, ["subscription", "resourceGroup", "caches"]),
  },

  // ── Browser helpers ───────────────────────────────────────────────
  {
    name: "geo_portal_status",
    description: "List CDP-connected browser pages and identify Azure Portal tabs.",
    inputSchema: schema({}),
  },
];

async function withPage(args, fn) {
  const page = await session.getPortalPage(args);
  return fn(page);
}

async function callTool(name, args = {}) {
  switch (name) {
    case "geo_assert_env":
      return { ok: await geo.assertGeoEnv(args) };

    case "geo_link_ui":
      return withPage(args, page => geo.invokeGeoLinkUI({ ...args, page }));
    case "geo_link_arm":
      return geo.invokeGeoLinkArm(args);
    case "geo_wait_link":
      return geo.waitGeoLink(args);
    case "geo_assert_pair":
      return { ok: await geo.assertGeoPair(args) };

    case "geo_failover":
      return withPage(args, page => geo.invokeGeoFailover({ ...args, page }));
    case "geo_assert_role_flip":
      return { ok: await geo.assertGeoRoleFlip(args) };
    case "geo_test_activity_log":
      return { ok: await geo.testGeoActivityLog(args) };

    case "geo_reboot_failover":
      return withPage(args, page => geo.invokeRebootThenFailover({ ...args, page }));
    case "geo_assert_concurrent_notifications":
      return withPage(args, page => geo.assertConcurrentNotifications({ ...args, page }));

    case "geo_unlink":
      return withPage(args, page => geo.invokeGeoUnlink({ ...args, page }));
    case "geo_assert_unlinked":
      return { ok: await geo.assertGeoUnlinked(args) };

    case "geo_test_dns":
      return { ok: await geo.testGeoDns(args) };

    case "geo_teardown":
      return { ok: await geo.invokeGeoTeardown(args) };

    case "geo_portal_status":
      return { pages: await session.listPages(args) };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
