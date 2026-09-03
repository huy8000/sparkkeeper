import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  createDatabase,
  AdminAuthRepository,
  adminUsers,
  auditEvents,
} from '@sparkkeeper/database';

import { runAdminCli } from '../src/admin-cli.js';

interface CliTestContext {
  readonly dir: string;
  readonly dbPath: string;
}

function createCliTestContext(): CliTestContext {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-cli-test-'));
  const dbPath = path.join(dir, 'test.db');
  return { dir, dbPath };
}

function cleanupCliTestContext(ctx: CliTestContext): void {
  rmSync(ctx.dir, { recursive: true, force: true });
}

function createMockStreams(inputLines: string[]) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  for (const line of inputLines) {
    stdin.write(line + '\n');
  }
  stdin.end();

  let stdoutText = '';
  stdout.on('data', (chunk) => {
    stdoutText += chunk.toString();
  });

  let stderrText = '';
  stderr.on('data', (chunk) => {
    stderrText += chunk.toString();
  });

  return {
    streams: { stdin, stdout, stderr, isTTY: false },
    getStdout: () => stdoutText,
    getStderr: () => stderrText,
  };
}

test('AdminBootstrapCli: successfully bootstraps first admin with hidden stdin', async () => {
  const ctx = createCliTestContext();
  try {
    const password = ['Super', 'Secret', 'Admin', 'Password', '123', '!'].join('');
    const { streams, getStdout, getStderr } = createMockStreams([password, password]);

    const exitCode = await runAdminCli({
      argv: ['node', 'admin-cli.js', 'bootstrap', '--username', 'Admin_Owner'],
      streams: streams,
      databasePath: ctx.dbPath,
    });

    assert.equal(exitCode, 0);
    assert.equal(getStdout(), 'SparkKeeper Admin initialized.\n');
    assert.equal(getStderr(), '');

    // Assert password and hash are not leaked in stdout or stderr
    assert.equal(getStdout().includes(password), false);
    assert.equal(getStderr().includes(password), false);

    // Verify DB
    const db = createDatabase({ databasePath: ctx.dbPath });
    try {
      const users = db.orm.select().from(adminUsers).all();
      assert.equal(users.length, 1);
      assert.equal(users[0].username, 'Admin_Owner');
      assert.equal(users[0].usernameNormalized, 'admin_owner');
      assert.equal(users[0].status, 'ACTIVE');

      const audits = db.orm.select().from(auditEvents).all();
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, 'ADMIN_INITIALIZED');
      assert.equal(audits[0].entityId, users[0].id);
    } finally {
      db.close();
    }

    // Repeat bootstrap should fail with ADMIN_ALREADY_INITIALIZED
    const repeatStreams = createMockStreams([password, password]);
    const repeatCode = await runAdminCli({
      argv: ['node', 'admin-cli.js', 'bootstrap', '--username', 'Admin_Owner2'],
      streams: repeatStreams.streams,
      databasePath: ctx.dbPath,
    });

    assert.equal(repeatCode, 1);
    assert.ok(repeatStreams.getStderr().includes('ADMIN_ALREADY_INITIALIZED'));
  } finally {
    cleanupCliTestContext(ctx);
  }
});

test('AdminBootstrapCli: handles pnpm -- separator and compiled invocation forms', async () => {
  const ctx = createCliTestContext();
  try {
    const password = ['Super', 'Secret', 'Admin', 'Password', '123', '!'].join('');
    const { streams } = createMockStreams([password, password]);

    // pnpm invocation form with --
    const exitCode = await runAdminCli({
      argv: ['node', 'admin-cli.js', 'bootstrap', '--', '--username', 'Admin_Owner'],
      streams,
      databasePath: ctx.dbPath,
    });
    assert.equal(exitCode, 0);
  } finally {
    cleanupCliTestContext(ctx);
  }
});

test('AdminBootstrapCli: strict non-TTY input framing matrix', async () => {
  const ctx = createCliTestContext();
  try {
    const testCases: Array<{ name: string; rawInput: string; expectSuccess: boolean }> = [
      { name: '0 lines (empty)', rawInput: '', expectSuccess: false },
      { name: '1 newline line', rawInput: 'pass1\n', expectSuccess: false },
      { name: 'unterminated first line', rawInput: 'pass1', expectSuccess: false },
      { name: 'unterminated second line', rawInput: 'pass1\npass2', expectSuccess: false },
      { name: '3 newline lines', rawInput: 'pass1\npass2\nextra\n', expectSuccess: false },
      {
        name: 'trailing bytes after 2nd newline',
        rawInput: 'pass1\npass2\ntrailing',
        expectSuccess: false,
      },
      {
        name: 'exact 2 newline lines',
        rawInput: ['Valid', 'Password', '123!\nValid', 'Password', '123!\n'].join(''),
        expectSuccess: true,
      },
    ];

    for (const tc of testCases) {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      stdin.write(tc.rawInput);
      stdin.end();

      const exitCode = await runAdminCli({
        argv: ['node', 'admin-cli.js', 'bootstrap', '--username', 'test_user'],
        streams: { stdin, stdout, stderr, isTTY: false },
        databasePath: ctx.dbPath,
      });

      if (tc.expectSuccess) {
        assert.equal(exitCode, 0, `Expected success for: ${tc.name}`);
      } else {
        assert.equal(exitCode, 1, `Expected failure for: ${tc.name}`);
      }
    }
  } finally {
    cleanupCliTestContext(ctx);
  }
});

test('AdminBootstrapCli: TTY reader handles multibyte UTF-8, code-point backspace, and rawMode cleanup', async () => {
  const { readHiddenPassword } = await import('../src/admin-cli.js');

  class MockTtyStream extends PassThrough {
    public isTTY = true;
    public rawModes: boolean[] = [];

    setRawMode(mode: boolean) {
      this.rawModes.push(mode);
      return this;
    }
  }

  // 1. Multibyte UTF-8 emoji input split across byte chunk boundaries with backspace
  const tty1 = new MockTtyStream();
  const stdout1 = new PassThrough();
  const stderr1 = new PassThrough();

  const promise1 = readHiddenPassword('Password: ', {
    stdin: tty1,
    stdout: stdout1,
    stderr: stderr1,
    isTTY: true,
  });

  // Write emoji 🔐 (F0 9F 94 90) split across 2 chunks
  const emojiBytes = Buffer.from('🔐', 'utf8');
  tty1.write(emojiBytes.subarray(0, 2));
  tty1.write(emojiBytes.subarray(2));

  // Write second emoji 🚀 (F0 9F 9A 80)
  tty1.write(Buffer.from('🚀', 'utf8'));

  // Send backspace (should remove the entire 🚀 code point, not just 1 byte)
  tty1.write(Buffer.from([0x7f]));

  // Send ASCII characters
  tty1.write(Buffer.from('Secret14!'));

  // Send Enter (\n)
  tty1.write(Buffer.from('\n'));

  const result1 = await promise1;
  assert.equal(result1, '🔐Secret14!');
  // Ensure raw mode was enabled then restored
  assert.equal(tty1.rawModes[0], true);
  assert.equal(tty1.rawModes[tty1.rawModes.length - 1], false);

  // 2. Ctrl-C abort restores rawMode and rejects
  const tty2 = new MockTtyStream();
  const stdout2 = new PassThrough();
  const stderr2 = new PassThrough();

  const promise2 = readHiddenPassword('Password: ', {
    stdin: tty2,
    stdout: stdout2,
    stderr: stderr2,
    isTTY: true,
  });

  tty2.write(Buffer.from('partial'));
  tty2.write(Buffer.from([0x03])); // Ctrl-C

  await assert.rejects(
    async () => {
      await promise2;
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Input aborted by user.');
      return true;
    },
  );
  assert.equal(tty2.rawModes[tty2.rawModes.length - 1], false);
});

test('AdminBootstrapCli: concurrent bootstrap contenders produce exactly one winner without sleeps', async () => {
  const ctx = createCliTestContext();
  const db1 = createDatabase({ databasePath: ctx.dbPath });
  const db2 = createDatabase({ databasePath: ctx.dbPath });
  db1.migrate();

  const repo1 = new AdminAuthRepository(db1);
  const repo2 = new AdminAuthRepository(db2);

  try {
    const hash1 =
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hash2 =
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNw$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    let readyCount = 0;
    let releaseBarrier!: () => void;
    const startLatch = new Promise<void>((r) => {
      releaseBarrier = r;
    });

    const contender = async (repo: AdminAuthRepository, username: string, hash: string) => {
      readyCount++;
      if (readyCount === 2) {
        releaseBarrier();
      }
      await startLatch;
      return repo.bootstrapInitialAdminWithAudit({ username, passwordHash: hash });
    };

    const [res1, res2] = await Promise.all([
      contender(repo1, 'AdminWinner', hash1),
      contender(repo2, 'AdminLoser', hash2),
    ]);

    const outcomes = [res1.outcome, res2.outcome].sort();
    assert.deepEqual(outcomes, ['ADMIN_ALREADY_INITIALIZED', 'SUCCESS']);

    // Check DB state
    const users = db1.orm.select().from(adminUsers).all();
    assert.equal(users.length, 1);
    const winnerUsername = users[0].username;
    assert.ok(winnerUsername === 'AdminWinner' || winnerUsername === 'AdminLoser');

    const expectedHash = winnerUsername === 'AdminWinner' ? hash1 : hash2;
    assert.equal(users[0].passwordHash, expectedHash);

    const audits = db1.orm.select().from(auditEvents).all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'ADMIN_INITIALIZED');
    assert.equal(audits[0].entityId, users[0].id);
  } finally {
    db1.close();
    db2.close();
    cleanupCliTestContext(ctx);
  }
});
