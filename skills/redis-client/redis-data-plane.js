"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const redisCli = process.env.REDIS_CLI || path.join(repoRoot, "tools", "redis-client", "redis-cli.exe");
const redisBenchmark = process.env.REDIS_BENCHMARK || path.join(repoRoot, "tools", "redis-client", "redis-benchmark.exe");

function redact(text) {
  return String(text || "").replace(/[A-Za-z0-9+/=]{30,}/g, "<redacted>");
}

function runTool(exe, args, timeout = 120000) {
  const result = spawnSync(exe, args, { encoding: "utf8", timeout });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error && result.error.message,
  };
}

function cacheHost(cacheName) {
  return String(cacheName).includes(".") ? String(cacheName) : `${cacheName}.redis.cache.windows.net`;
}

function redisCliCommand({ host, cache, key, port = 6379, args, timeout = 60000 }) {
  const targetHost = host || cacheHost(cache);
  if (!targetHost || !key || !Array.isArray(args) || !args.length) {
    throw new Error("redisCliCommand requires { host/cache, key, args }");
  }
  const result = runTool(redisCli, ["-h", targetHost, "-p", String(port), "-a", key, "--raw", ...args], timeout);
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed on ${targetHost}: ${redact(result.stderr || result.stdout || result.error).slice(0, 500)}`);
  }
  return result.stdout.trim();
}

function roleFromInfo(info) {
  return (String(info || "").match(/^role:(.+)$/m) || [, "<missing>"])[1].trim();
}

function validateRedisPair({
  primary,
  secondary,
  primaryKey,
  secondaryKey,
  primaryPort = 6379,
  secondaryPort = 6379,
  expectedPrimaryRole,
  expectedSecondaryRole,
  checkRoles = Boolean(expectedPrimaryRole || expectedSecondaryRole),
  expectDbsizeMatch = true,
}) {
  const primaryHost = cacheHost(primary);
  const secondaryHost = cacheHost(secondary);
  const primaryPing = redisCliCommand({ host: primaryHost, key: primaryKey, port: primaryPort, args: ["PING"] });
  const secondaryPing = redisCliCommand({ host: secondaryHost, key: secondaryKey, port: secondaryPort, args: ["PING"] });
  const primaryDb = Number(redisCliCommand({ host: primaryHost, key: primaryKey, port: primaryPort, args: ["DBSIZE"] }));
  const secondaryDb = Number(redisCliCommand({ host: secondaryHost, key: secondaryKey, port: secondaryPort, args: ["DBSIZE"] }));

  const result = {
    primary,
    secondary,
    primaryPing,
    secondaryPing,
    primaryDb,
    secondaryDb,
    dbsizeMatch: primaryDb === secondaryDb,
  };

  if (checkRoles) {
    result.primaryRole = roleFromInfo(redisCliCommand({ host: primaryHost, key: primaryKey, port: primaryPort, args: ["INFO", "replication"] }));
    result.secondaryRole = roleFromInfo(redisCliCommand({ host: secondaryHost, key: secondaryKey, port: secondaryPort, args: ["INFO", "replication"] }));
    result.rolePass = (!expectedPrimaryRole || result.primaryRole === expectedPrimaryRole) &&
      (!expectedSecondaryRole || result.secondaryRole === expectedSecondaryRole);
  } else {
    result.rolePass = true;
  }

  result.pass = primaryPing === "PONG" &&
    secondaryPing === "PONG" &&
    (!expectDbsizeMatch || result.dbsizeMatch) &&
    result.rolePass;
  return result;
}

function runRedisBenchmark({
  cache,
  host,
  key,
  port = 6379,
  benchmarkCount = "1000000",
  keyRange = "20000",
  tests = "set",
  pipeline = "100",
  quiet = true,
}) {
  const targetHost = host || cacheHost(cache);
  if (!targetHost || !key) throw new Error("runRedisBenchmark requires { cache/host, key }");
  const args = [
    "-h", targetHost,
    "-p", String(port),
    "-a", key,
    "-n", String(benchmarkCount),
    "-r", String(keyRange),
    "-t", String(tests),
    "-P", String(pipeline),
  ];
  if (quiet) args.push("-q");

  const result = runTool(redisBenchmark, args, 300000);
  if (result.stderr.trim()) console.log(`[benchmark stderr redacted]\n${redact(result.stderr).trim()}`);
  if (result.status !== 0) throw new Error(`redis-benchmark failed status=${result.status} error=${result.error || ""}`);
  return (result.stdout || "").trim();
}

async function waitForRedisPairHealthy(options) {
  const attempts = Number(options.attempts || 20);
  const intervalMs = Number(options.intervalMs || 30000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = validateRedisPair(options);
      result.attempt = attempt;
      console.log(JSON.stringify(result));
      if (result.pass) return result;
    } catch (error) {
      console.log(JSON.stringify({ attempt, pass: false, error: redact(error.message) }));
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Redis pair did not become healthy after ${attempts} attempts`);
}

module.exports = {
  redisCli,
  redisBenchmark,
  redact,
  runTool,
  cacheHost,
  redisCliCommand,
  roleFromInfo,
  validateRedisPair,
  runRedisBenchmark,
  waitForRedisPairHealthy,
};
