#!/usr/bin/env node
"use strict";

const readline = require("readline");
const { tools, callTool } = require("./tools");

const SERVER_INFO = {
  name: "geo-replication-setup-mcp",
  version: "0.1.0",
};

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  write({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolTextResponse(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function handle(request) {
  const id = request.id;

  if (request.method === "notifications/initialized") return;

  switch (request.method) {
    case "initialize":
      return result(id, {
        protocolVersion: request.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools });
    case "tools/call": {
      const name = request.params?.name;
      if (!name) throw new Error("Missing tool name");
      const value = await callTool(name, request.params?.arguments || {});
      return result(id, toolTextResponse(value));
    }
    default:
      throw new Error(`Unknown method: ${request.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

console.error("Geo Replication Setup MCP Server started");

rl.on("line", async line => {
  if (!line.trim()) return;

  let request;
  try {
    request = JSON.parse(line);
    await handle(request);
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    error(request?.id ?? null, -32000, err.message || String(err));
  }
});

process.on("SIGINT", () => process.exit(0));
