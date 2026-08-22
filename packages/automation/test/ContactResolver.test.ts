import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ContactResolver,
  normalizeDisplayName,
  resolveTargetContactIdentity,
  type ContactConversationSource,
  type ConversationCandidate,
  type ConversationListScrollResult,
} from '../src/index.js';

test('resolves one exact displayName as FOUND', async () => {
  const source = new BatchSource([[candidate(0, 'Alice'), candidate(1, 'Bob')]]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Alice' });

  assert.equal(result.type, 'FOUND');
  assert.equal(result.matchCount, 1);
  assert.equal(result.scrollAttempts, 0);
});

test('returns NOT_FOUND after a bounded scan for a missing target', async () => {
  const source = new BatchSource([[candidate(0, 'Alice')]]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Missing User' });

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(result.matchCount, 0);
  assert.equal(source.scrollCalls, 1);
});

test('returns AMBIGUOUS when two exact display names are visible', async () => {
  const source = new BatchSource([[candidate(0, 'Alice'), candidate(1, 'Alice')]]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Alice' });

  assert.equal(result.type, 'AMBIGUOUS');
  assert.equal(result.matchCount, 2);
  assert.equal(source.scrollCalls, 0);
});

test('normalizes display names with trim only', async () => {
  const source = new BatchSource([[candidate(0, '  Test User  ')]]);

  const result = await new ContactResolver(source).resolve({ displayName: ' Test User ' });

  assert.equal(result.type, 'FOUND');
  assert.equal(normalizeDisplayName('  Test User  '), 'Test User');
});

test('does not use substring matching', async () => {
  const source = new BatchSource([[candidate(0, 'Alice Zhang')]]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Alice' });

  assert.equal(result.type, 'NOT_FOUND');
});

test('does not use fuzzy matching', async () => {
  const source = new BatchSource([[candidate(0, 'Alicia')]]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Alice' });

  assert.equal(result.type, 'NOT_FOUND');
});

test('finds a target loaded after bounded scrolling', async () => {
  const source = new BatchSource([
    [candidate(0, 'Alice')],
    [candidate(1, 'Bob')],
    [candidate(2, 'Test User')],
  ]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Test User' });

  assert.equal(result.type, 'FOUND');
  assert.equal(result.scrollAttempts, 2);
});

test('terminates after the configured no-progress limit', async () => {
  const source = new RepeatingSource([candidate(0, 'Alice')], true);

  const result = await new ContactResolver(source, { noProgressLimit: 2 }).resolve({
    displayName: 'Missing User',
  });

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(result.scrollAttempts, 3);
});

test('enforces the maximum scroll-attempt limit', async () => {
  const source = new RepeatingSource([candidate(0, 'Alice')], true);

  const result = await new ContactResolver(source, {
    maxScrollAttempts: 2,
    noProgressLimit: 10,
  }).resolve({ displayName: 'Missing User' });

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(result.scrollAttempts, 2);
  assert.equal(source.scrollCalls, 2);
});

test('enforces the maximum total resolve duration', async () => {
  const source = new RepeatingSource([candidate(0, 'Alice')], true);
  let nowCalls = 0;

  const result = await new ContactResolver(source, {
    maxDurationMs: 1,
    now: () => (nowCalls++ === 0 ? 0 : 1),
  }).resolve({ displayName: 'Missing User' });

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(result.scrollAttempts, 0);
  assert.equal(source.scrollCalls, 0);
});

test('deduplicates repeated virtual-list observations by list index', async () => {
  const source = new BatchSource([
    [candidate(0, 'Alice')],
    [candidate(0, 'Alice'), candidate(1, 'Bob')],
  ]);

  const result = await new ContactResolver(source).resolve({ displayName: 'Bob' });

  assert.equal(result.type, 'FOUND');
  assert.equal(result.matchCount, 1);
  assert.equal(result.scrollAttempts, 1);
});

test('rejects an empty target instead of selecting a default conversation', async () => {
  const source = new BatchSource([[candidate(0, 'Alice')]]);

  await assert.rejects(
    new ContactResolver(source).resolve({ displayName: '   ' }),
    /must be non-empty/i,
  );
  assert.equal(source.resetCalls, 0);
});

test('loads and trims the runtime target without exposing it in an error', () => {
  assert.deepEqual(resolveTargetContactIdentity({ MVP_TARGET_DISPLAY_NAME: '  Test User  ' }), {
    displayName: 'Test User',
  });
  assert.throws(() => resolveTargetContactIdentity({}), /MVP_TARGET_DISPLAY_NAME/);
});

function candidate(listIndex: number, displayName: string): ConversationCandidate {
  return { listIndex, displayName };
}

class BatchSource implements ContactConversationSource {
  public resetCalls = 0;
  public scrollCalls = 0;
  private batchIndex = 0;

  public constructor(private readonly batches: readonly ConversationCandidate[][]) {}

  public async resetConversationList(): Promise<void> {
    this.resetCalls += 1;
    this.batchIndex = 0;
  }

  public async getConversationCandidates(): Promise<ConversationCandidate[]> {
    return this.batches[this.batchIndex] ?? [];
  }

  public async scrollConversationList(): Promise<ConversationListScrollResult> {
    this.scrollCalls += 1;
    const lastBatchIndex = Math.max(0, this.batches.length - 1);
    if (this.batchIndex >= lastBatchIndex) {
      return { moved: false, atEnd: true };
    }
    this.batchIndex += 1;
    return { moved: true, atEnd: this.batchIndex >= lastBatchIndex };
  }
}

class RepeatingSource implements ContactConversationSource {
  public scrollCalls = 0;

  public constructor(
    private readonly batch: ConversationCandidate[],
    private readonly moves: boolean,
  ) {}

  public async resetConversationList(): Promise<void> {}

  public async getConversationCandidates(): Promise<ConversationCandidate[]> {
    return this.batch;
  }

  public async scrollConversationList(): Promise<ConversationListScrollResult> {
    this.scrollCalls += 1;
    return { moved: this.moves, atEnd: false };
  }
}
