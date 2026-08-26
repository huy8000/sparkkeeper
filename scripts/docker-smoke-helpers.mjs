import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { TextDecoder } from 'node:util';

/* global AbortController, fetch */

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.quiet ? 'pipe' : 'inherit',
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  if (options.expectedStatus !== undefined) {
    assert.equal(
      result.status,
      options.expectedStatus,
      `${command} ${args.join(' ')} exited ${result.status}: ${result.stderr}`,
    );
  } else if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

export function compose(args, env, options = {}) {
  return run('docker', ['compose', ...args], { ...options, env });
}

export async function waitForJson(url, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && predicate(body)) return { response, body };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

export async function readSseFrame(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream', origin: 'http://127.0.0.1:8080' },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/u);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let data = '';
    while (!data.includes('\n\n')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      data += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    return data.slice(0, data.indexOf('\n\n') + 2);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function inspectContainer(service, env) {
  const id = compose(['ps', '-q', service], env, { quiet: true }).trim();
  assert.notEqual(id, '', `${service} container is missing`);
  return JSON.parse(run('docker', ['inspect', id], { quiet: true }))[0];
}

export async function waitForContainerHealth(service, env, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inspected = inspectContainer(service, env);
    if (inspected.State.Health?.Status === 'healthy') return inspected;
    if (inspected.State.Status === 'exited' || inspected.State.Health?.Status === 'unhealthy') {
      throw new Error(
        `${service} became ${inspected.State.Health?.Status ?? inspected.State.Status}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${service} health`);
}
