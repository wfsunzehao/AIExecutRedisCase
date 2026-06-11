# Redis Benchmark Azure MCP Server

This MCP server exposes the benchmark capabilities in [`../benchmark.js`](../benchmark.js)
as JSON-callable tools for AI agents. Each tool is a thin wrapper over the
PowerShell/Python scripts under [`../../../scripts/`](../../../scripts/); the
full end-to-end workflow and pitfalls live in [`../SKILL.md`](../SKILL.md).

All tools shell out locally; they require Azure CLI (`az`), OpenSSH
(`ssh`/`scp`), Python 3.10+, and the per-VM SSH keys in `%USERPROFILE%\.ssh`.
Long-running tools (`bench_wait_caches`, `bench_watch`) block until their
internal poll loop terminates — invoke them through `run_in_terminal` with
`mode=sync` and a generous `timeout`, never `mode=async`.

## Run

```powershell
node .\Claude-Redis\skills\Redis_Benchmark\mcp\server.js
```

## MCP Client Config Example

```json
{
  "mcpServers": {
    "redis-benchmark-azure": {
      "command": "node",
      "args": ["d:\\Claude-Redis\\Claude-Redis\\skills\\Redis_Benchmark\\mcp\\server.js"]
    }
  }
}
```

## Tools

| Capability | Tool | Backing script |
| --- | --- | --- |
| 1 assert env | `bench_assert_env` | `Assert-BenchEnv.ps1` |
| 2 create caches | `bench_create_caches` | `New-RedisCaches.ps1` |
| 3 wait caches | `bench_wait_caches` | `Wait-CacheSucceeded.ps1` |
| 4 start VMs | `bench_start_vms` | `Start-BenchVMs.ps1` |
| 5 deploy runner | `bench_deploy_runner` | `Deploy-RunnerScripts.ps1` |
| 6 update params | `bench_update_parameters` | `Update-Parameters.ps1` |
| 7 restart | `bench_restart` | `Restart-AllBench.ps1` |
| 8 watch | `bench_watch` | `Watch-Bench.ps1` |
| 9 pull results | `bench_pull_results` | `Pull-Results.ps1` |
| 10 generate report | `bench_generate_report` | `generate-unified-report.py` |
| 11 teardown | `bench_teardown` | `Invoke-Teardown.ps1` |

## Example Calls

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "bench_create_caches", "arguments": { "date": "0608" } } }
```

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "bench_generate_report", "arguments": { "date": "0608" } } }
```
