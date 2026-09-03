import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createDatabase, AdminAuthRepository } from '@sparkkeeper/database';
import { validateAdminUsername } from '@sparkkeeper/shared';

import { PasswordHasher } from './security/PasswordHasher.js';
import {
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  validatePasswordInput,
} from './security/PasswordPolicy.js';

export interface CliStreams {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly isTTY?: boolean;
}

/**
 * Reads a single line of hidden password input from a TTY stream.
 * In TTY mode, uses raw mode without echoing characters and handles multi-byte UTF-8 and code points safely.
 *
 * Exactly one finalization path settles the promise for every termination mode
 * (success, Ctrl-C, read error, end, close, unexpected throw): listeners are
 * removed exactly once and raw mode is restored exactly once when it was enabled.
 * A terminal-restore failure is never silently swallowed; the rejection never
 * contains the entered password.
 */
export async function readHiddenPassword(prompt: string, streams: CliStreams): Promise<string> {
  const isTTY = streams.isTTY ?? (streams.stdin as unknown as { isTTY?: boolean }).isTTY ?? false;
  if (!isTTY) {
    throw new Error('readHiddenPassword called in non-TTY mode');
  }

  return new Promise<string>((resolvePromise, reject) => {
    const stdin = streams.stdin as NodeJS.ReadStream;
    const decoder = new StringDecoder('utf8');
    const codePoints: string[] = [];
    const wasRaw = typeof stdin.isRaw === 'boolean' ? stdin.isRaw : false;

    let settled = false;
    let listenersRemoved = false;
    let rawEnabled = false;

    const removeListeners = (): void => {
      if (listenersRemoved) return;
      listenersRemoved = true;
      stdin.removeListener('data', onData);
      stdin.removeListener('error', onError);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('close', onClose);
    };

    /**
     * The single finalization path: stops listening, restores the terminal, and
     * settles the promise exactly once. A restore failure replaces the outcome
     * with a safe error that never leaks the entered password.
     */
    const finalize = (
      outcome:
        | { readonly ok: true; readonly value: string }
        | { readonly ok: false; readonly error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      removeListeners();
      if (rawEnabled && typeof stdin.setRawMode === 'function') {
        try {
          stdin.setRawMode(wasRaw);
        } catch (restoreError) {
          const baseMessage = outcome.ok
            ? 'Password input finished but terminal restoration failed.'
            : `Password input failed (${outcome.error.message}) and terminal restoration failed.`;
          reject(new Error(baseMessage, { cause: restoreError }));
          return;
        }
      }
      if (outcome.ok) {
        resolvePromise(outcome.value);
      } else {
        reject(outcome.error);
      }
    };

    const onData = (chunk: Buffer | string): void => {
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const text = decoder.write(buf);
        for (const char of text) {
          const codePoint = char.codePointAt(0);
          // Ctrl-C (\x03)
          if (codePoint === 3) {
            streams.stdout.write('\n');
            finalize({ ok: false, error: new Error('Input aborted by user.') });
            return;
          }

          // Enter (\r or \n)
          if (codePoint === 13 || codePoint === 10) {
            streams.stdout.write('\n');
            finalize({ ok: true, value: codePoints.join('') });
            return;
          }

          // Backspace (\x08 or \x7f)
          if (codePoint === 8 || codePoint === 127) {
            if (codePoints.length > 0) {
              codePoints.pop();
            }
            continue;
          }

          // Regular Unicode code point
          codePoints.push(char);
        }
      } catch (err) {
        finalize({
          ok: false,
          error: err instanceof Error ? err : new Error('Password input handler failed.'),
        });
      }
    };

    const onError = (err: Error): void => {
      finalize({ ok: false, error: err });
    };

    const onEnd = (): void => {
      finalize({ ok: false, error: new Error('Input ended before a password was entered.') });
    };

    const onClose = (): void => {
      finalize({
        ok: false,
        error: new Error('Input stream closed before a password was entered.'),
      });
    };

    try {
      streams.stdout.write(prompt);
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
        rawEnabled = true;
      }
      stdin.resume();
      stdin.on('data', onData);
      stdin.on('error', onError);
      stdin.on('end', onEnd);
      stdin.on('close', onClose);
    } catch (err) {
      finalize({
        ok: false,
        error: err instanceof Error ? err : new Error('Password input could not start.'),
      });
    }
  });
}

/**
 * Reads password and confirmation from non-TTY input as exactly two newline-terminated lines.
 */
export async function readNonTtyPasswords(stdin: NodeJS.ReadableStream): Promise<[string, string]> {
  return new Promise<[string, string]>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });

    stdin.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      const text = fullBuffer.toString('utf8');

      if (text.length === 0 || (!text.endsWith('\n') && !text.endsWith('\r\n'))) {
        reject(
          new Error(
            'Non-TTY bootstrap input requires exactly two newline-terminated password lines.',
          ),
        );
        return;
      }

      const normalized = text.replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');
      if (lines.length !== 3 || lines[2] !== '') {
        reject(
          new Error(
            'Non-TTY bootstrap input requires exactly two newline-terminated password lines.',
          ),
        );
        return;
      }

      const password = lines[0] ?? '';
      const confirmation = lines[1] ?? '';
      resolvePromise([password, confirmation]);
    });

    stdin.on('error', reject);
  });
}

export interface BootstrapCliOptions {
  readonly argv: readonly string[];
  readonly streams?: CliStreams;
  readonly databasePath?: string;
}

export async function runAdminCli(options: BootstrapCliOptions): Promise<number> {
  const streams: CliStreams = options.streams ?? {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: process.stdin.isTTY,
  };

  let rawArgs = options.argv.slice(2);
  // Normalize standalone '--' at start or immediately following 'bootstrap'
  if (rawArgs.length > 0 && rawArgs[0] === '--') {
    rawArgs = rawArgs.slice(1);
  }
  if (rawArgs.length === 0 || rawArgs[0] !== 'bootstrap') {
    streams.stderr.write('Usage: admin-cli bootstrap --username <username>\n');
    return 1;
  }

  let args = rawArgs.slice(1);
  if (args.length > 0 && args[0] === '--') {
    args = args.slice(1);
  }

  let username: string | undefined;
  let hasUsername = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--username') {
      if (hasUsername) {
        streams.stderr.write('Error: Duplicate --username option provided.\n');
        return 1;
      }
      if (i + 1 >= args.length) {
        streams.stderr.write('Error: --username requires a non-empty value.\n');
        return 1;
      }
      const val = args[i + 1];
      if (!val || val.startsWith('-')) {
        streams.stderr.write('Error: --username requires a non-empty value.\n');
        return 1;
      }
      username = val;
      hasUsername = true;
      i++;
    } else {
      streams.stderr.write(`Error: Unknown option or unexpected argument: ${arg}\n`);
      return 1;
    }
  }

  if (!username) {
    streams.stderr.write('Error: --username <username> is required.\n');
    return 1;
  }

  try {
    validateAdminUsername(username);
  } catch {
    streams.stderr.write(
      'Error: Invalid username. Must be 3-64 characters matching ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$.\n',
    );
    return 1;
  }

  const isTTY = streams.isTTY ?? (streams.stdin as unknown as { isTTY?: boolean }).isTTY ?? false;
  let password: string;
  let confirmation: string;

  try {
    if (isTTY) {
      password = await readHiddenPassword('Enter admin password: ', streams);
      confirmation = await readHiddenPassword('Confirm admin password: ', streams);
    } else {
      [password, confirmation] = await readNonTtyPasswords(streams.stdin);
    }
  } catch (err) {
    streams.stderr.write(
      `Error reading password: ${err instanceof Error ? err.message : 'Unknown error'}\n`,
    );
    return 1;
  }

  if (password !== confirmation) {
    streams.stderr.write('Error: Password and confirmation do not match.\n');
    return 1;
  }

  try {
    validatePasswordInput(password);
  } catch {
    streams.stderr.write(
      `Error: Password must be between ${MIN_PASSWORD_CODE_POINTS} and ${MAX_PASSWORD_CODE_POINTS} characters.\n`,
    );
    return 1;
  }

  // Initialize and migrate database
  let database;
  try {
    database = createDatabase({
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
    });
    database.migrate();
  } catch {
    streams.stderr.write('Error: Failed to initialize or migrate database.\n');
    return 1;
  }

  try {
    const hasher = new PasswordHasher();
    const passwordHash = await hasher.hash(password);

    const repository = new AdminAuthRepository(database);
    const result = repository.bootstrapInitialAdminWithAudit({
      username,
      passwordHash,
      now: new Date(),
    });

    if (result.outcome === 'ADMIN_ALREADY_INITIALIZED') {
      streams.stderr.write('Error: ADMIN_ALREADY_INITIALIZED — an admin user already exists.\n');
      return 1;
    }

    streams.stdout.write('SparkKeeper Admin initialized.\n');
    return 0;
  } catch {
    streams.stderr.write('Error: Admin bootstrap failed due to an unexpected error.\n');
    return 1;
  } finally {
    database.close();
  }
}

// Entrypoint execution when invoked directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runAdminCli({ argv: process.argv }).then((code) => {
    process.exit(code);
  });
}
