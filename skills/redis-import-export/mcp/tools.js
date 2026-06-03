"use strict";

const session = require("./browser-session");
const ie = require("../create-import-export");

function s(description) { return { type: "string", description }; }
function n(description) { return { type: "number", description }; }
function b(description) { return { type: "boolean", description }; }

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

function armSchema(properties, required = []) {
  return { type: "object", properties, required };
}

const tools = [
  // ── Capability 1: prereq ──────────────────────────────────────────
  {
    name: "ie_assert_env",
    description: "Capability 1 (ie-prereq): verify az CLI, redis-cli, playwright, sub/RG/cache (Premium or AMR), and CDP Edge on 9222.",
    inputSchema: armSchema({
      subscription: s("Target subscription GUID."),
      resourceGroup: s("Existing resource group."),
      cache: s("Existing Premium/AMR cache name."),
      cdpPort: n("CDP port. Default 9222."),
    }, ["subscription", "resourceGroup", "cache"]),
  },

  // ── Capability 2: provision storage ───────────────────────────────
  {
    name: "ie_provision_storage",
    description: "Capability 2 (ie-provision-storage): create same-region StorageV2 Standard_LRS account + container.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name (used to derive location)."),
      saName: s("Storage account name (3-24 lowercase alphanumeric)."),
      container: s("Container name."),
    }, ["subscription", "resourceGroup", "cache", "saName", "container"]),
  },
  {
    name: "ie_assert_storage",
    description: "Assert storage account is same region as cache and container exists.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      saName: s("Storage account name."),
      container: s("Container name."),
    }, ["subscription", "resourceGroup", "cache", "saName", "container"]),
  },

  // ── Capability 3: enable non-ssl ──────────────────────────────────
  {
    name: "ie_enable_nonssl_ui",
    description: "Capability 3 (ie-enable-nonssl, UI): toggle 'Allow access only via SSL' to No on Advanced settings blade.",
    inputSchema: schema({
      rid: s("Cache full ARM resource ID."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
    }, ["rid"]),
  },
  {
    name: "ie_enable_nonssl_arm",
    description: "Capability 3 (ARM fallback): az redis update --set enableNonSslPort=true.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
    }, ["subscription", "resourceGroup", "cache"]),
  },
  {
    name: "ie_assert_nonssl_enabled",
    description: "Poll az redis show until enableNonSslPort=true (default 60s).",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      maxSeconds: n("Polling deadline in seconds. Default 60."),
    }, ["subscription", "resourceGroup", "cache"]),
  },

  // ── Capability 4: populate ────────────────────────────────────────
  {
    name: "ie_populate",
    description: "Capability 4 (ie-populate): run redis-benchmark to load ~20k keys, write dbsize-pre-export.txt evidence.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      evidenceDir: s("Directory for dbsize-*.txt files (e.g. D:\\Claude-Redis\\screenshots\\<cache>\\)."),
      keysApprox: n("Approx unique keys (-r). Default 20000."),
      opsTotal: n("Total ops (-n). Default 1,000,000."),
      pipeline: n("Pipeline size (-P). Default 100."),
      clustered: b("Add -c for clustered caches. Default false."),
    }, ["subscription", "resourceGroup", "cache", "evidenceDir"]),
  },

  // ── Capability 5: portal export ───────────────────────────────────
  {
    name: "ie_portal_export",
    description: "Capability 5 (ie-portal-export, UI): drive Portal Export data blade end-to-end and submit Export.",
    inputSchema: schema({
      rid: s("Cache ARM ID."),
      saName: s("Storage account."),
      container: s("Container name."),
      prefix: s("Blob name prefix (e.g. <cache>-portal-<MMDD>)."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
      screenshotDir: s("Optional screenshot dir; falls back to SHOT_DIR env var."),
    }, ["rid", "saName", "container", "prefix"]),
  },
  {
    name: "ie_assert_export_blobs",
    description: "Poll storage container for at least 1 non-empty .rdb PageBlob under prefix.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      saName: s("Storage account."),
      container: s("Container name."),
      prefix: s("Blob name prefix."),
      maxMinutes: n("Polling deadline. Default 10."),
    }, ["subscription", "resourceGroup", "saName", "container", "prefix"]),
  },

  // ── Capability 6: flushall ────────────────────────────────────────
  {
    name: "ie_flushall",
    description: "Capability 6 (ie-flushall): FLUSHALL via redis-cli, poll DBSIZE to 0, write dbsize-post-flush.txt.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      evidenceDir: s("Directory for dbsize-*.txt files."),
      maxSeconds: n("Poll deadline for DBSIZE=0. Default 30."),
    }, ["subscription", "resourceGroup", "cache", "evidenceDir"]),
  },

  // ── Capability 7: portal import ───────────────────────────────────
  {
    name: "ie_portal_import",
    description: "Capability 7 (ie-portal-import, UI): drive Portal Import data blade end-to-end (Choose Blob > Enter drill-in > checkbox > Select > Import).",
    inputSchema: schema({
      rid: s("Cache ARM ID."),
      saName: s("Storage account."),
      container: s("Container name."),
      blobName: s("Full blob name (resolve via az storage blob list --prefix)."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
      screenshotDir: s("Optional screenshot dir; falls back to SHOT_DIR env var."),
    }, ["rid", "saName", "container", "blobName"]),
  },
  {
    name: "ie_assert_import_restored",
    description: "Poll DBSIZE up to maxMinutes for >= baseline * ratio; sample SCAN; write dbsize-post-import.txt.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      evidenceDir: s("Directory for dbsize-*.txt files."),
      baseline: n("Pre-export DBSIZE baseline."),
      ratio: n("Min recovery ratio. Default 0.95."),
      maxMinutes: n("Polling deadline. Default 5."),
    }, ["subscription", "resourceGroup", "cache", "evidenceDir", "baseline"]),
  },

  // ── Capability 8: teardown ────────────────────────────────────────
  {
    name: "ie_teardown",
    description: "Capability 8 (ie-teardown): set enableNonSslPort=false, purge export blobs under prefix, optionally delete storage account.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      saName: s("Storage account."),
      container: s("Container name."),
      prefix: s("Blob name prefix to purge."),
      deleteStorageAccount: b("Also drop the storage account. Default false."),
    }, ["subscription", "resourceGroup", "cache", "saName", "container", "prefix"]),
  },

  // ── Browser helpers ───────────────────────────────────────────────
  {
    name: "ie_portal_status",
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
    case "ie_assert_env":
      return { ok: await ie.assertIeEnv(args) };

    case "ie_provision_storage":
      return await ie.invokeIeProvisionStorage(args);
    case "ie_assert_storage":
      return await ie.assertIeStorage(args);

    case "ie_enable_nonssl_ui":
      return withPage(args, page => ie.invokeIeEnableNonSslUI({ ...args, page }));
    case "ie_enable_nonssl_arm":
      return { ok: await ie.invokeIeEnableNonSslArm(args) };
    case "ie_assert_nonssl_enabled":
      return { ok: await ie.assertIeNonSslEnabled(args) };

    case "ie_populate":
      return await ie.invokeIePopulate(args);

    case "ie_portal_export":
      return withPage(args, page => ie.invokeIePortalExport({ ...args, page }));
    case "ie_assert_export_blobs":
      return await ie.assertIeExportBlobs(args);

    case "ie_flushall":
      return await ie.invokeIeFlushAll(args);

    case "ie_portal_import":
      return withPage(args, page => ie.invokeIePortalImport({ ...args, page }));
    case "ie_assert_import_restored":
      return await ie.assertIeImportRestored(args);

    case "ie_teardown":
      return { ok: await ie.invokeIeTeardown(args) };

    case "ie_portal_status":
      return { pages: await session.listPages(args) };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
