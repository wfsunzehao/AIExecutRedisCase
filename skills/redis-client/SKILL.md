---
name: redis-client
description: |
  Use when a test case or user request mentions redis-cli, redis-benchmark,
  Redis client command execution, or direct Redis data-plane validation. This
  skill owns the Redis client execution flow and uses the repository Redis
  client assertion script only to validate captured command output.
applyTo: "**"
---

# Redis Client Command Validation

## Purpose

Use this skill to prove that Redis commands were actually executed through the
current repository's Redis client and that Redis returned the expected data-plane
results. When a case mentions redis-cli, use the project-local Redis CLI under
the tools redis-client directory. When a case mentions redis-benchmark, use the
project-local benchmark executable from the same directory.

This skill is the authoritative runbook for Redis client execution. It owns the
choice of executable, command order, inputs, cleanup, result reporting, and
secret handling. The JavaScript file named redis-client-assertions.js in this
skill folder is assertion-only: it validates captured process status, stdout,
stderr, expected command output, expected error output, and benchmark metrics.
It must not launch redis-cli, launch redis-benchmark, choose executable paths,
read Redis credentials, or create result artifacts.

Validation must be performed by JavaScript assertions. Do not rely only on a
printed command line, terminal transcript, or process exit code.

## Use When

Use this skill when the test case or user request asks for one of these outcomes:

- Use redis-cli or Redis client to run commands.
- Use redis-benchmark to run Redis performance or load commands.
- Verify Redis data-plane connectivity through a client.
- Run PING, SET, GET, DEL, EXISTS, INFO, or another Redis command
  outside the Azure Portal Console.
- Prove that a Redis command was actually accepted by the Redis server.
- Add assertions for Redis command or benchmark output in a test run.

## Do Not Use When

Do not use this skill for these tasks:

- Portal Console validation through the Azure Portal. Use the portal-console skill.
- Portal blade-only validation. Use the portal-validation skill.
- Cache creation or deletion unless the case explicitly asks for Redis client
  data-plane validation as a separate step.
- TLS-only Azure Cache for Redis validation when only bundled non-TLS Redis
  clients are available. The bundled Windows Redis CLI 3.2.100 does not support
  TLS command-line options.

## Required Inputs

Confirm these values before starting. If any required value is missing, pause and
ask the user.

- Test case ID or task name.
- Redis host name.
- Redis port.
- Authentication mode and required secret source.
- Exact Redis command or validation scenario requested by the case.
- Expected command output, benchmark metric, state change, or assertion criteria.
- Whether non-TLS access is allowed when using the bundled Redis CLI.
- Result file path. Default to the result file in this skill folder unless the
  user specifies another result file.

Never print, persist, or echo access keys, passwords, tokens, or connection
strings in scripts, logs, screenshots, or result files.

## Safety And Execution Rules

1. Use Redis client executables from the current repository only.
2. Execute redis-cli and redis-benchmark according to this skill. Do not delegate
   command execution, executable selection, authentication handling, cleanup, or
   result-file writing to redis-client-assertions.js.
3. Use redis-client-assertions.js only for JavaScript assertions over captured
   process records and benchmark output.
4. Do not add JavaScript snippets, shell snippets, or per-test code blocks to this
  skill document.
5. Treat command execution as failed if the client process exits non-zero, if
   stderr contains a connection/authentication error, or if the expected output
   assertion fails.
6. Use a unique case-scoped test key only when the requested test content does
  not specify the key to use.
7. Clean up a test key only when cleanup is explicitly requested by the test
  content or when the requested scenario includes cleanup validation.
8. Do not print, persist, or echo access keys, passwords, tokens, or connection
  strings.
9. Run redis-cli and redis-benchmark validations inline by default. Do not create
  per-command JSON, text, transcript, or artifact output files unless the user
  explicitly asks for those files.

## Assertion Flow

Execute only the Redis commands and validation steps explicitly mentioned by the
test case or user request. Do not add PING, GET, DEL, EXISTS, cleanup, or other
follow-up commands unless they are part of the requested test content.

For each requested command, assert the exact expected output, regular expression,
numeric result, or follow-up state read specified by the test case. If the
expected output or assertion criteria are missing, pause and ask for them before
running extra validation commands.

## Redis Benchmark Assertion Flow

For redis-benchmark validation, use JavaScript assertions for both the process
and benchmark output:

1. Assert the project-local redis-benchmark executable exists before running it.
2. Run a bounded benchmark so the test is deterministic and does not overload the
   target, unless the case specifies another workload.
3. Assert the process exit code indicates success.
4. Assert stderr does not contain authentication, connection, TLS, timeout, or
  Redis error text.
5. Assert stdout contains the requested benchmark command sections, such as
   SET and GET.
6. Assert stdout contains a completed request count or throughput metric, such as
   requests completed or requests per second.
7. If the case specifies a minimum throughput threshold, parse the metric and
  assert it is greater than or equal to that threshold. Do not invent a threshold
  when the case does not specify one.

## Assertion Script

Use redis-client-assertions.js in this skill folder for all redis-cli and
redis-benchmark output checks. The script is assertion-only. It accepts captured
process records from this skill's execution flow and returns JSON assertion
results. A captured process record contains only safe metadata such as process
status, stdout, stderr, expected output, expected error pattern, benchmark tests,
and optional benchmark thresholds. Do not include access keys, passwords, tokens,
or connection strings in assertion input.

The script supports these assertion types: process success, exact command
output, expected error output, default Redis CLI sequence output, and benchmark
output. It must not execute Redis commands, read environment secrets, construct
Redis command arguments, mask command-line authentication arguments, or append to
result files.

Provide secrets to redis-cli or redis-benchmark through environment variables or
another non-logged secret source while following this skill. Mask authentication
details before recording command metadata in any result summary.

## TLS Limitation

The bundled Redis CLI is Redis CLI 3.2.100 for Windows and does not expose TLS
options. Apply the same TLS caution to any bundled Redis benchmark executable
unless it is confirmed to support TLS. For Azure Cache for Redis instances that
require TLS on the SSL port, record the bundled-client result
as SKIPPED or INCONCLUSIVE unless the user provides a TLS-capable Redis CLI or
Redis benchmark client. Do not claim a TLS-only cache was validated by a non-TLS
bundled client.

If the test permits non-TLS validation and the cache has the non-SSL port enabled,
target that port explicitly and record that non-TLS validation was used.

## Validation Outcomes

Use these statuses consistently:

- PASS: The repository Redis client executed, every JavaScript assertion passed,
  every requested benchmark metric assertion passed, and any temporary test key
  was cleaned up and confirmed absent.
- FAIL: The client or benchmark could not start, exited non-zero, returned an
  authentication or connection error, returned unexpected output, missed a
  benchmark metric, or cleanup assertion failed.
- INCONCLUSIVE: The client ran but the case's expected output was ambiguous or
  unavailable, benchmark output did not expose a decisive metric, or the
  environment prevented a decisive assertion.
- SKIPPED: The case does not require Redis client validation, or the target cache
  requires TLS but only a bundled non-TLS client is available, or the case requires
  redis-benchmark but no project-local benchmark executable is present.

## Result File Reporting

Run command validation inline by default. The normal evidence artifact is the
selected result file summary, not a separate file for every redis-cli or
redis-benchmark invocation. If the user explicitly asks for raw command output
artifacts, create only the requested files and record their paths in the result
summary.

Append a Redis client validation block to the selected result file. Include:

- A separator line.
- Run date.
- Test case ID or task name.
- Mode: repository Redis client + JavaScript assertions.
- Redis client or benchmark path.
- Redis host and port.
- Authentication mode, with secrets masked.
- Commands or benchmark workload validated.
- Assertion results.
- Benchmark metrics when applicable.
- Cleanup result for any test key.
- Final Overall Result line: PASS, FAIL, INCONCLUSIVE, or SKIPPED.

After appending, immediately verify the write:

1. Re-read the result file.
2. Confirm the test case ID or Redis host appears in the newly appended tail.
3. Confirm the final Overall Result line is present.

## Common Pitfalls

| Pitfall | Required handling |
| --- | --- |
| Only checking exit code | Add stdout assertions for the expected Redis result and follow-up state. |
| Logging secrets | Mask access keys and use non-logged secret input. |
| TLS-only cache with bundled CLI | Do not use the bundled CLI as proof; use a TLS-capable client or mark SKIPPED/INCONCLUSIVE. |
| Reusing a fixed key | Use the requested key, or a unique case-scoped key only when no key is specified. |
| Treating a successful write response as full proof | Assert the requested command output; add reads only when requested. |
| Cleanup not verified | Verify cleanup only when cleanup is requested. |
| Missing redis-benchmark executable | Assert the project-local benchmark path exists before running; record SKIPPED or INCONCLUSIVE if unavailable. |
| Benchmark without metric assertion | Assert command sections and the throughput metric or the case-specified metric are present. |
| Invented performance threshold | Only assert a minimum throughput when the case explicitly specifies one. |