#!/usr/bin/env node
"use strict";

const redisDataPlane = require("../redis-client/redis-data-plane");

function parseArgs(argv) {
  const args = { benchmark: false, wait: false, attempts: 20, intervalMs: 30000, benchmarkCount: "1000000", keyRange: "20000" };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--benchmark") args.benchmark = true;
    else if (arg === "--wait") args.wait = true;
    else if (arg === "--skip-role") args.skipRole = true;
    else if (arg === "--no-dbsize-match") args.noDbsizeMatch = true;
    else if (arg.startsWith("--")) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      const name = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[name] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

const { cacheHost, redact } = redisDataPlane;

function validateGeoDataPlane(options) {
  return redisDataPlane.validateRedisPair({
    ...options,
    expectedPrimaryRole: options.expectedPrimaryRole || "master",
    expectedSecondaryRole: options.expectedSecondaryRole || "slave",
    checkRoles: !options.skipRole,
    expectDbsizeMatch: !options.noDbsizeMatch,
  });
}

function runBenchmark({ primary, primaryKey, benchmarkCount, keyRange }) {
  return redisDataPlane.runRedisBenchmark({ cache: primary, key: primaryKey, benchmarkCount, keyRange, tests: "set", pipeline: "100" });
}

async function waitGeoDataPlaneHealthy(options) {
  const attempts = Number(options.attempts || 20);
  const intervalMs = Number(options.intervalMs || 30000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = validateGeoDataPlane(options);
      result.attempt = attempt;
      console.log(JSON.stringify(result));
      if (result.pass) return result;
    } catch (error) {
      console.log(JSON.stringify({ attempt, pass: false, error: redact(error.message) }));
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Geo data plane did not become healthy after ${attempts} attempts`);
}

function requireConfig(args) {
  const config = {
    primary: args.primary || process.env.REDIS_PRIMARY_CACHE,
    secondary: args.secondary || process.env.REDIS_SECONDARY_CACHE,
    primaryKey: process.env[args.primaryKeyEnv || "REDIS_PRIMARY_KEY"],
    secondaryKey: process.env[args.secondaryKeyEnv || "REDIS_SECONDARY_KEY"],
    expectedPrimaryRole: args.expectedPrimaryRole || "master",
    expectedSecondaryRole: args.expectedSecondaryRole || "slave",
    skipRole: args.skipRole,
    noDbsizeMatch: args.noDbsizeMatch,
    attempts: args.attempts,
    intervalMs: args.intervalMs,
    benchmarkCount: args.benchmarkCount,
    keyRange: args.keyRange,
  };
  const missing = [];
  for (const field of ["primary", "secondary", "primaryKey", "secondaryKey"]) {
    if (!config[field]) missing.push(field);
  }
  if (missing.length) throw new Error(`Missing required config: ${missing.join(", ")}`);
  return config;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = requireConfig(args);
  console.log(`[key] primary key length=${config.primaryKey.length}`);
  console.log(`[key] secondary key length=${config.secondaryKey.length}`);

  if (args.benchmark) {
    console.log(`[benchmark] writing SET ops to ${cacheHost(config.primary)}:6379`);
    console.log(runBenchmark(config));
  }

  if (args.wait) {
    await waitGeoDataPlaneHealthy(config);
    return;
  }

  const result = validateGeoDataPlane(config);
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(redact(error && error.message || error));
    process.exit(1);
  });
}

module.exports = {
  validateGeoDataPlane,
  waitGeoDataPlaneHealthy,
  runBenchmark,
};
