"use strict";

const bench = require("../benchmark");

function s(description) { return { type: "string", description }; }
function n(description) { return { type: "number", description }; }
function b(description) { return { type: "boolean", description }; }
function a(description, itemType = "string") {
  return { type: "array", description, items: { type: itemType } };
}

function schema(properties, required = []) {
  return { type: "object", properties, required };
}

const tools = [
  {
    name: "bench_assert_env",
    description: "Capability 1: verify az/ssh/scp/python/jq, both subscriptions, and each VM's SSH key.",
    inputSchema: schema({}),
  },
  {
    name: "bench_create_caches",
    description: "Capability 2: fire-and-forget create the 19 caches for this run, then poll until Succeeded.",
    inputSchema: schema({
      date: s("Run date MMDD, e.g. 0608."),
      timeoutMin: n("Provisioning poll deadline in minutes. Default 30."),
    }, ["date"]),
  },
  {
    name: "bench_wait_caches",
    description: "Capability 3: poll az redis list until the named caches all report Succeeded.",
    inputSchema: schema({
      names: a("Full cache names to wait for."),
      subscription: s("Cache subscription GUID. Defaults to the cache subscription."),
      resourceGroup: s("Cache resource group. Defaults to machine2e_group."),
      timeoutMin: n("Poll deadline in minutes. Default 60."),
      intervalSec: n("Poll interval in seconds. Default 180."),
    }, ["names"]),
  },
  {
    name: "bench_start_vms",
    description: "Capability 4: az vm start the 8 benchmark VMs and wait until all report VM running.",
    inputSchema: schema({}),
  },
  {
    name: "bench_deploy_runner",
    description: "Capability 5: scp Run_multiple_benchmarks_ssl.sh + clean-restart.sh to every VM and strip CRLF.",
    inputSchema: schema({
      keyDir: s("SSH key directory. Default %USERPROFILE%\\.ssh."),
    }),
  },
  {
    name: "bench_update_parameters",
    description: "Capability 6: resolve cache hostnames + keys and write each VM's Parameters.txt.",
    inputSchema: schema({
      date: s("Run date MMDD."),
      skipFile: s("Optional path to a skip list (caches-<date>-skip.txt)."),
    }, ["date"]),
  },
  {
    name: "bench_restart",
    description: "Capability 7: scp + run clean-restart.sh on every (or selected) VM; verifies FIRST_LINE contains the run date.",
    inputSchema: schema({
      date: s("Run date MMDD."),
      only: a("Optional subset of VM suffixes, e.g. ['SC2SC3']."),
    }, ["date"]),
  },
  {
    name: "bench_watch",
    description: "Capability 8: poll every VM until all memtier processes are idle (long-running).",
    inputSchema: schema({
      date: s("Run date MMDD."),
      intervalSec: n("Poll interval in seconds. Default 900."),
      maxHours: n("Watch deadline in hours. Default 6."),
    }, ["date"]),
  },
  {
    name: "bench_pull_results",
    description: "Capability 9: scp results-*-<date>.json and output-<date>.txt from every VM to a local folder.",
    inputSchema: schema({
      date: s("Run date MMDD."),
      outDir: s("Local output directory. Default <scripts>/results-<date>."),
      keyDir: s("SSH key directory. Default %USERPROFILE%\\.ssh."),
      verifyOnly: b("When true, skip the scp and only verify what's already local."),
    }, ["date"]),
  },
  {
    name: "bench_generate_report",
    description: "Capability 10: build cache-comparison-<date>.html from the pulled results JSON.",
    inputSchema: schema({
      date: s("Run date MMDD."),
      resultsDir: s("Results directory. Default <scripts>/results-<date>."),
      out: s("Output HTML path. Default <scripts>/cache-comparison-<date>.html."),
      pythonExe: s("Python executable. Default 'python'."),
    }, ["date"]),
  },
  {
    name: "bench_teardown",
    description: "Capability 11: deallocate the 8 VMs and delete this run's caches (--no-wait).",
    inputSchema: schema({
      date: s("Run date MMDD."),
      skipVm: b("Skip VM deallocation."),
      skipCache: b("Skip cache deletion."),
    }, ["date"]),
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "bench_assert_env":
      return bench.assertEnv();
    case "bench_create_caches":
      return bench.createCaches(args);
    case "bench_wait_caches":
      return bench.waitCaches(args);
    case "bench_start_vms":
      return bench.startVms();
    case "bench_deploy_runner":
      return bench.deployRunner(args);
    case "bench_update_parameters":
      return bench.updateParameters(args);
    case "bench_restart":
      return bench.restart(args);
    case "bench_watch":
      return bench.watch(args);
    case "bench_pull_results":
      return bench.pullResults(args);
    case "bench_generate_report":
      return bench.generateReport(args);
    case "bench_teardown":
      return bench.teardown(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
