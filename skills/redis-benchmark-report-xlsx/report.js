"use strict";

/**
 * Redis Benchmark Report (txt -> xlsx) — Node implementation.
 *
 * This module is the executable contract for the `redis-benchmark-report-xlsx`
 * skill. The heavy lifting lives in a per-run Python generator under
 * `../../../tools/` (canonical reference: `gen_0520_sheet.py`); this module
 * scaffolds a new dated copy, runs it, and verifies the produced workbook.
 * SKILL.md is the source of truth for the exact xlsx layout and pitfalls.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// tools/ sits at the repo root: <repo>/tools. This file is in
// <repo>/Claude-Redis/skills/redis-benchmark-report-xlsx.
const TOOLS_DIR = path.resolve(__dirname, "..", "..", "..", "tools");
const DEFAULT_REFERENCE = "gen_0520_sheet.py";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || TOOLS_DIR,
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
 * Copy the reference generator to gen_<MMDD>_sheet.py so it can be edited for
 * the new run (TXT / OUT / REPORT_DATE / WEEK_LABELS / ORIG_XLSX / KEEP_DATES).
 * Returns the new script path; never overwrites an existing file.
 */
function scaffoldGenerator({ thisMmdd, referenceScript, toolsDir } = {}) {
  if (!thisMmdd) throw new Error("scaffoldGenerator requires { thisMmdd } (MMDD).");
  const dir = toolsDir || TOOLS_DIR;
  const ref = path.join(dir, referenceScript || DEFAULT_REFERENCE);
  if (!fs.existsSync(ref)) throw new Error(`Reference generator not found: ${ref}`);
  const dest = path.join(dir, `gen_${thisMmdd}_sheet.py`);
  if (fs.existsSync(dest)) throw new Error(`Target already exists, refusing to overwrite: ${dest}`);
  fs.copyFileSync(ref, dest);
  return { reference: ref, script: dest };
}

/**
 * Run a (already edited) generator script with python.
 */
function runGenerator({ script, toolsDir, pythonExe } = {}) {
  if (!script) throw new Error("runGenerator requires { script }.");
  const dir = toolsDir || TOOLS_DIR;
  const file = path.isAbsolute(script) ? script : path.join(dir, script);
  if (!fs.existsSync(file)) throw new Error(`Generator script not found: ${file}`);
  return run(pythonExe || "python", [file], { cwd: dir });
}

/**
 * Verify the produced workbook via openpyxl: returns sheet names, the new
 * sheet's dimensions, merged-cell count, and chart count.
 */
function verifyReport({ xlsx, sheet, pythonExe } = {}) {
  if (!xlsx) throw new Error("verifyReport requires { xlsx }.");
  const snippet = [
    "import json, sys",
    "import openpyxl",
    "wb = openpyxl.load_workbook(sys.argv[1])",
    "names = wb.sheetnames",
    "target = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else names[0]",
    "ws = wb[target]",
    "print(json.dumps({",
    "  'sheets': names,",
    "  'target': target,",
    "  'max_row': ws.max_row,",
    "  'max_col': ws.max_column,",
    "  'merged_cells': len(ws.merged_cells.ranges),",
    "  'charts': len(ws._charts),",
    "}))",
  ].join("\n");
  return run(pythonExe || "python", ["-c", snippet, xlsx, sheet || ""], { cwd: TOOLS_DIR });
}

module.exports = {
  TOOLS_DIR,
  DEFAULT_REFERENCE,
  run,
  scaffoldGenerator,
  runGenerator,
  verifyReport,
};
