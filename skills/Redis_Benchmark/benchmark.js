"use strict";

/**
 * Redis Benchmark on Azure VMs — Node implementation.
 *
 * This module is the executable contract for the `redis-benchmark-azure` skill.
 * Each capability is a thin, composable wrapper around the existing
 * PowerShell/Python scripts under `../../scripts/`. SKILL.md is the source of
 * truth for the end-to-end workflow; this file is the source of truth for how
 * each capability is invoked (inputs, defaults, script mapping).
 *
 * Capabilities are atomic: each advances exactly one phase of the benchmark
 * run and returns the script's stdout/stderr/exit code. Long-waiting phases
 * (wait-caches / watch) block until their internal poll loop terminates.
 */

const path = require("path");
const { spawn } = require("child_process");

// Scripts live in <repo>/Claude-Redis/scripts; this file is in
// <repo>/Claude-Redis/skills/Redis_Benchmark.
const SCRIPTS_DIR = path.resolve(__dirname, "..", "..", "scripts");

const SUBSCRIPTIONS = {
  vm: "fc2f20f5-602a-4ebd-97e6-4fae3f1f6424", // CacheTeam - Redis Perf and Stress Resources
  cache: "1e57c478-0901-4c02-8d35-49db234b78d2", // Cache Team - Vendor CTI Testing 2
};

const RESOURCE_GROUPS = {
  vm: "MemtierbenchmarkTest",
  cache: "machine2e_group",
};

const VMS = [
  "BC0BC1", "BC2BC3", "BC4BC5BC6",
  "P1P2", "P3P4P5",
  "SC0SC1", "SC2SC3", "SC4SC5SC6",
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || SCRIPTS_DIR,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      const result = { command: `${cmd} ${args.join(" ")}`, code, stdout, stderr };
      if (code === 0) resolve(result);
      else reject(new Error(`${cmd} exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

/**
 * Invoke a PowerShell script in SCRIPTS_DIR.
 * @param {string} script  Script file name (e.g. "New-RedisCaches.ps1").
 * @param {object} named   Named params; arrays are expanded into multiple
 *                         values (for [string[]] params). null/undefined skip.
 * @param {string[]} switches  Switch params (e.g. ["VerifyOnly"]).
 */
function pwsh(script, named = {}, switches = []) {
  const file = path.join(SCRIPTS_DIR, script);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file];
  for (const [key, value] of Object.entries(named)) {
    if (value === undefined || value === null) continue;
    args.push(`-${key}`);
    if (Array.isArray(value)) args.push(...value.map(String));
    else args.push(String(value));
  }
  for (const sw of switches) args.push(`-${sw}`);
  return run("powershell", args);
}

function python(script, args = [], opts = {}) {
  const exe = opts.pythonExe || "python";
  const file = path.join(SCRIPTS_DIR, script);
  return run(exe, [file, ...args], opts);
}

// ── Capability 1: assert environment ────────────────────────────────
function assertEnv() {
  return pwsh("Assert-BenchEnv.ps1");
}

// ── Capability 2: create this run's caches ──────────────────────────
function createCaches({ date, timeoutMin } = {}) {
  if (!date) throw new Error("createCaches requires { date } (MMDD).");
  return pwsh("New-RedisCaches.ps1", { Date: date, TimeoutMin: timeoutMin });
}

// ── Capability 3: wait until caches report Succeeded ────────────────
function waitCaches({ names, subscription, resourceGroup, timeoutMin, intervalSec } = {}) {
  if (!names || !names.length) throw new Error("waitCaches requires { names: [...] }.");
  return pwsh("Wait-CacheSucceeded.ps1", {
    Subscription: subscription || SUBSCRIPTIONS.cache,
    ResourceGroup: resourceGroup || RESOURCE_GROUPS.cache,
    Names: names,
    TimeoutMin: timeoutMin,
    IntervalSec: intervalSec,
  });
}

// ── Capability 4: start the 8 benchmark VMs ─────────────────────────
function startVms() {
  return pwsh("Start-BenchVMs.ps1");
}

// ── Capability 5: deploy runner scripts to every VM ─────────────────
function deployRunner({ keyDir } = {}) {
  return pwsh("Deploy-RunnerScripts.ps1", { KeyDir: keyDir });
}

// ── Capability 6: write Parameters.txt on every VM ──────────────────
function updateParameters({ date, skipFile } = {}) {
  if (!date) throw new Error("updateParameters requires { date } (MMDD).");
  return pwsh("Update-Parameters.ps1", { Date: date, SkipFile: skipFile });
}

// ── Capability 7: clean + restart benchmarks on every (or some) VM ──
function restart({ date, only } = {}) {
  if (!date) throw new Error("restart requires { date } (MMDD).");
  return pwsh("Restart-AllBench.ps1", { Date: date, Only: only });
}

// ── Capability 8: watch until every VM is idle ──────────────────────
function watch({ date, intervalSec, maxHours } = {}) {
  if (!date) throw new Error("watch requires { date } (MMDD).");
  return pwsh("Watch-Bench.ps1", { Date: date, IntervalSec: intervalSec, MaxHours: maxHours });
}

// ── Capability 9: pull result JSON to local ─────────────────────────
function pullResults({ date, outDir, keyDir, verifyOnly } = {}) {
  if (!date) throw new Error("pullResults requires { date } (MMDD).");
  return pwsh(
    "Pull-Results.ps1",
    { Date: date, OutDir: outDir, KeyDir: keyDir },
    verifyOnly ? ["VerifyOnly"] : [],
  );
}

// ── Capability 10: generate the unified comparison report ───────────
function generateReport({ date, resultsDir, out, pythonExe } = {}) {
  if (!date) throw new Error("generateReport requires { date } (MMDD).");
  const args = ["--date", date];
  if (resultsDir) args.push("--results-dir", resultsDir);
  if (out) args.push("--out", out);
  return python("generate-unified-report.py", args, { pythonExe });
}

// ── Capability 11: teardown (deallocate VMs + delete caches) ────────
function teardown({ date, skipVm, skipCache } = {}) {
  if (!date) throw new Error("teardown requires { date } (MMDD).");
  const switches = [];
  if (skipVm) switches.push("SkipVm");
  if (skipCache) switches.push("SkipCache");
  return pwsh("Invoke-Teardown.ps1", { Date: date }, switches);
}

module.exports = {
  SCRIPTS_DIR,
  SUBSCRIPTIONS,
  RESOURCE_GROUPS,
  VMS,
  run,
  pwsh,
  python,
  assertEnv,
  createCaches,
  waitCaches,
  startVms,
  deployRunner,
  updateParameters,
  restart,
  watch,
  pullResults,
  generateReport,
  teardown,
};
