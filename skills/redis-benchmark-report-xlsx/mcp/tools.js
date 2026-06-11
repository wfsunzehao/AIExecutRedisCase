"use strict";

const report = require("../report");

function s(description) { return { type: "string", description }; }
function b(description) { return { type: "boolean", description }; }

function schema(properties, required = []) {
  return { type: "object", properties, required };
}

const tools = [
  {
    name: "report_scaffold",
    description: "Copy the reference generator to gen_<MMDD>_sheet.py for editing. Never overwrites.",
    inputSchema: schema({
      thisMmdd: s("New run date MMDD, e.g. 0608."),
      referenceScript: s("Reference generator file name. Default gen_0520_sheet.py."),
      toolsDir: s("Override the tools directory. Default <repo>/tools."),
    }, ["thisMmdd"]),
  },
  {
    name: "report_run",
    description: "Run an (edited) generator script with python to produce the xlsx.",
    inputSchema: schema({
      script: s("Generator script name or absolute path, e.g. gen_0608_sheet.py."),
      toolsDir: s("Override the tools directory. Default <repo>/tools."),
      pythonExe: s("Python executable. Default 'python'."),
    }, ["script"]),
  },
  {
    name: "report_verify",
    description: "Inspect a produced xlsx via openpyxl: sheet names, dims, merged cells, chart count.",
    inputSchema: schema({
      xlsx: s("Path to the produced xlsx."),
      sheet: s("Sheet to inspect. Default the first (newest) sheet."),
      pythonExe: s("Python executable. Default 'python'."),
    }, ["xlsx"]),
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "report_scaffold":
      return report.scaffoldGenerator(args);
    case "report_run":
      return report.runGenerator(args);
    case "report_verify":
      return report.verifyReport(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };
