"use strict";

const session = require("./browser-session");
const pers = require("../create-persistence");

function s(description) { return { type: "string", description }; }
function n(description) { return { type: "number", description }; }
function b(description) { return { type: "boolean", description }; }
function a(description, itemType = "string") {
  return { type: "array", description, items: { type: itemType } };
}
function o(description) { return { type: "object", description }; }

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
  // ── Capability 1: prereq ─────────────────────────────────────────
  {
    name: "pers_assert_env",
    description: "Capability 1 (pers-prereq): verify az / playwright / redis-cli / redis-benchmark / CDP Edge 9222.",
    inputSchema: armSchema({
      subscription: s("Target subscription GUID."),
      resourceGroup: s("Existing resource group."),
      cdpPort: n("CDP port. Default 9222."),
      redisToolsDir: s("Default D:\\Claude-Redis\\tools\\redis."),
    }, ["subscription", "resourceGroup"]),
  },

  // ── Capability 2: provision caches ───────────────────────────────
  {
    name: "pers_provision_caches",
    description: "Capability 2 (pers-provision-caches): PUT Premium P1 caches (API 2024-03-01) and wait until Succeeded.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      caches: { type: "array", description: "[{ name, location }]",
                items: { type: "object", properties: {
                  name: s("Cache name."), location: s("ARM location, e.g. centraluseuap.") },
                  required: ["name", "location"] } },
      maxMinutes: n("Polling deadline. Default 60."),
      pollSec: n("Poll interval. Default 180."),
    }, ["subscription", "resourceGroup", "caches"]),
  },

  // ── Capability 3: provision storage ──────────────────────────────
  {
    name: "pers_provision_storage",
    description: "Capability 3 (pers-provision-storage): create Standard_LRS / StorageV2 storage account.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      name: s("Storage account name (3-24, lowercase alphanumeric)."),
      location: s("ARM location. Default centraluseuap."),
    }, ["subscription", "resourceGroup", "name"]),
  },

  // ── Capability 4: enable non-SSL ─────────────────────────────────
  {
    name: "pers_enable_nonssl_ui",
    description: "Capability 4 (pers-enable-nonssl, UI): flip enableNonSslPort via Advanced settings blade.",
    inputSchema: schema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
    }, ["subscription", "resourceGroup", "cache"]),
  },
  {
    name: "pers_enable_nonssl_arm",
    description: "Capability 4 (pers-enable-nonssl, ARM fallback): az redis update --set enableNonSslPort=true.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
    }, ["subscription", "resourceGroup", "cache"]),
  },
  {
    name: "pers_assert_nonssl_enabled",
    description: "Poll az redis show .enableNonSslPort until true (max 60s default).",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      maxSeconds: n("Polling deadline. Default 60."),
    }, ["subscription", "resourceGroup", "cache"]),
  },

  // ── Capability 5: enable persistence ─────────────────────────────
  {
    name: "pers_enable_persistence_ui",
    description: "Capability 5 (pers-enable-persistence): pick AOF or RDB on /persistence blade, bind storage, Save.",
    inputSchema: schema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      mode: s("'AOF' or 'RDB'."),
      storageAccount: s("Storage account name to bind."),
      rdbFrequencyMin: n("RDB backup frequency in minutes. Default 15. Ignored for AOF."),
      tenant: s("Tenant. Default microsoft.onmicrosoft.com."),
      screenshotDir: s("Optional screenshot dir. Default D:\\Claude-Redis\\screenshots\\<cache>."),
    }, ["subscription", "resourceGroup", "cache", "mode", "storageAccount"]),
  },
  {
    name: "pers_wait_ready",
    description: "Poll cache until provisioningState=Succeeded and rdb/aof flag matches mode.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      mode: s("'AOF' or 'RDB'."),
      maxMinutes: n("Polling deadline. Default 30."),
      intervalSec: n("Poll interval. Default 60."),
    }, ["subscription", "resourceGroup", "cache", "mode"]),
  },

  // ── Capability 6: populate ───────────────────────────────────────
  {
    name: "pers_populate",
    description: "Capability 6 (pers-populate): redis-benchmark on port 6379 until DBSIZE >= 19000.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      cache: s("Cache name."),
      keysApprox: n("Unique key count target (-r). Default 20000."),
      opsTotal: n("Total operations (-n). Default 1,000,000."),
      pipeline: n("Pipeline depth (-P). Default 100."),
      clustered: b("Pass -c for clustered caches. Default false."),
    }, ["subscription", "resourceGroup", "cache"]),
  },

  // ── Capability 7: verify blob ────────────────────────────────────
  {
    name: "pers_assert_blob",
    description: "Capability 7 (pers-verify-blob): poll storage container for AOF/RDB blob matching pattern.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      storageAccount: s("Storage account name."),
      container: s("Container name. Default <cacheLower>-redis-persistence when 'cache' is given."),
      cache: s("Cache name, used to derive default container."),
      pattern: s("Blob name substring, e.g. 'aof' or 'rdb'."),
      timeoutMin: n("Polling deadline. Default 20."),
      intervalSec: n("Poll interval. Default 60."),
    }, ["subscription", "resourceGroup", "storageAccount", "pattern"]),
  },

  // ── Capability 8: teardown ───────────────────────────────────────
  {
    name: "pers_teardown",
    description: "Capability 8 (pers-teardown): delete caches (--no-wait) and optionally the storage account.",
    inputSchema: armSchema({
      subscription: s("Subscription GUID."),
      resourceGroup: s("Resource group."),
      caches: a("Full cache names to delete."),
      storageAccount: s("Storage account name (deleted when deleteStorageAccount=true)."),
      deleteStorageAccount: b("Default true."),
    }, ["subscription", "resourceGroup", "caches"]),
  },

  // ── Browser helper ───────────────────────────────────────────────
  {
    name: "pers_portal_status",
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
    case "pers_assert_env":
      return { ok: await pers.assertPersistenceEnv(args) };

    case "pers_provision_caches":
      return { ok: await pers.invokePersistenceCacheProvision(args) };
    case "pers_provision_storage":
      return { ok: await pers.invokePersistenceStorageProvision(args) };

    case "pers_enable_nonssl_ui":
      return withPage(args, page => pers.invokePersistenceEnableNonSslUI({ ...args, page }));
    case "pers_enable_nonssl_arm":
      return { ok: await pers.invokePersistenceEnableNonSslArm(args) };
    case "pers_assert_nonssl_enabled":
      return { ok: await pers.assertPersistenceNonSslEnabled(args) };

    case "pers_enable_persistence_ui":
      return withPage(args, page => pers.invokePersistenceEnableUI({ ...args, page }));
    case "pers_wait_ready":
      return await pers.waitPersistenceReady(args);

    case "pers_populate":
      return await pers.invokePersistencePopulate(args);
    case "pers_assert_blob":
      return { hits: await pers.assertPersistenceBlob(args) };

    case "pers_teardown":
      return { ok: await pers.invokePersistenceTeardown(args) };

    case "pers_portal_status":
      return { pages: await session.listPages(args) };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
