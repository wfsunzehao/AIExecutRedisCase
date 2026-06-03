const assert = require('assert/strict');

const ERROR_PATTERN = /NOAUTH|WRONGPASS|invalid password|Connection refused|timeout|timed out|TLS|SSL|ERR/i;

function normalizeText(value) {
  return String(value || '').trim();
}

function assertProcessSucceeded(result, label = 'Redis client command') {
  assert.equal(result.error, undefined, `${label} failed to start: ${result.error}`);
  assert.equal(Number(result.status), 0, `${label} exited ${result.status}: ${normalizeText(result.stderr)}`);
  assert.doesNotMatch(normalizeText(result.stderr), ERROR_PATTERN, `${label} stderr: ${normalizeText(result.stderr)}`);

  return 'process=success';
}

function assertExactOutput(result, expectedOutput, label = 'Redis client command') {
  assertProcessSucceeded(result, label);
  assert.equal(normalizeText(result.stdout), String(expectedOutput), `Unexpected output for ${label}`);

  return 'stdout=expected';
}

function assertExpectedError(result, expectedErrorPattern, label = 'Redis client command') {
  assert.equal(result.error, undefined, `${label} failed to start: ${result.error}`);

  const pattern = new RegExp(expectedErrorPattern, 'i');
  const combinedOutput = `${normalizeText(result.stdout)}\n${normalizeText(result.stderr)}`.trim();
  assert.match(combinedOutput, pattern, `Expected error output to match ${expectedErrorPattern}`);

  return 'error-output=expected';
}

function assertDefaultCliSequence(outputs) {
  assert.ok(outputs, 'Missing outputs for default Redis CLI sequence');

  const assertions = [
    assertExactOutput(outputs.PING, 'PONG', 'PING'),
    assertExactOutput(outputs.SET, 'OK', 'SET'),
    assertProcessSucceeded(outputs.GET, 'GET'),
    assertExactOutput(outputs.DEL, '1', 'DEL'),
    assertExactOutput(outputs.EXISTS, '0', 'EXISTS'),
  ];

  const getExpectedValue = outputs.GET.expectedOutput;
  assert.notEqual(getExpectedValue, undefined, 'Missing expected output for GET');
  assert.equal(normalizeText(outputs.GET.stdout), String(getExpectedValue), 'Unexpected output for GET');
  assertions.push('GET=value');

  return assertions;
}

function assertBenchmarkOutput(result, options = {}) {
  const assertions = [assertProcessSucceeded(result, 'redis-benchmark')];
  const stdout = normalizeText(result.stdout);
  const benchmarkTests = String(options.benchmarkTests || 'set,get')
    .split(',')
    .map((testName) => testName.trim())
    .filter(Boolean);

  for (const testName of benchmarkTests) {
    assert.match(stdout, new RegExp(`\\b${testName}\\b`, 'i'), `benchmark output should include ${testName.toUpperCase()} section`);
    assertions.push(`section=${testName.toUpperCase()}`);
  }

  assert.match(stdout, /requests completed|requests per second/i, 'benchmark output should include completion or throughput metrics');
  assertions.push('metric=present');

  const requestsPerSecond = [...stdout.matchAll(/([0-9]+(?:\.[0-9]+)?)\s+requests per second/gi)]
    .map((match) => Number(match[1]));

  assert.ok(requestsPerSecond.length > 0, 'benchmark output should include at least one requests per second metric');
  assert.ok(requestsPerSecond.every(Number.isFinite), `invalid throughput metrics: ${requestsPerSecond.join(', ')}`);
  assertions.push('requests-per-second=parsed');

  if (options.minRequestsPerSecond !== undefined) {
    const threshold = Number(options.minRequestsPerSecond);
    assert.ok(Number.isFinite(threshold), 'Minimum requests per second must be a number');
    assert.ok(
      requestsPerSecond.every((value) => value >= threshold),
      `throughput below threshold ${threshold}: ${requestsPerSecond.join(', ')}`,
    );
    assertions.push('requests-per-second>=threshold');
  }

  return { assertions, requestsPerSecond };
}

function runAssertion(input) {
  assert.ok(input && typeof input === 'object', 'Assertion input must be a JSON object');

  switch (input.assertion) {
    case 'process-success':
      return { assertions: [assertProcessSucceeded(input.result, input.label)] };
    case 'exact-output':
      return { assertions: [assertExactOutput(input.result, input.expectedOutput, input.label)] };
    case 'expected-error':
      return { assertions: [assertExpectedError(input.result, input.expectedErrorPattern, input.label)] };
    case 'default-cli-sequence':
      return { assertions: assertDefaultCliSequence(input.outputs) };
    case 'benchmark-output':
      return assertBenchmarkOutput(input.result, input);
    default:
      throw new Error(`Unknown assertion type: ${input.assertion}`);
  }
}

function main() {
  try {
    const rawInput = require('fs').readFileSync(0, 'utf8');
    const input = JSON.parse(rawInput);
    const result = runAssertion(input);

    console.log(JSON.stringify({
      status: 'PASS',
      assertion: input.assertion,
      ...result,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: 'FAIL',
      message: error.message,
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  assertProcessSucceeded,
  assertExactOutput,
  assertExpectedError,
  assertDefaultCliSequence,
  assertBenchmarkOutput,
  runAssertion,
};

if (require.main === module) {
  main();
}
