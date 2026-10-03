import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryVerifier } from '../src/douyin/delivery/DeliveryVerifier.js';
import type { ResolutionWitness } from '../src/douyin/resolver/ResolutionWitness.js';
import { FakeDeliveryPort, verifiedFixture } from './deliveryFixture.js';
import { request } from './resolverFixture.js';

const limits = { verificationTimeoutMs: 150, pollIntervalMs: 5 };
const guard = { check: async () => null };
test('verifier arms before one durable boundary/click, returns only a safe summary', async () => {
  const f = await verifiedFixture();
  let boundaries = 0;
  const verifier = new DeliveryVerifier(f.port, guard);
  const boundary = {
    record: async () => {
      boundaries++;
      assert.equal(f.port.armed, 1);
      assert.equal(f.port.clicks, 0);
    },
  };
  const result = await verifier.verify(f.witness, 'Synthetic text', boundary, limits);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(boundaries, 1);
  assert.equal(f.port.clicks, 1);
  assert.equal(f.port.disposed, 1);
  assert.equal(JSON.stringify(result).includes('Synthetic'), false);
  assert.deepEqual(await verifier.verify(f.witness, 'Synthetic text', boundary, limits), result);
  assert.equal(
    (await verifier.verify(f.witness, 'Different intent', boundary, limits)).status,
    'DELIVERY_UNKNOWN',
  );
  assert.equal(f.port.clicks, 1);
  assert.equal(boundaries, 1);
});
test('forged or wrong page/context cannot arm a verifier', async () => {
  const f = await verifiedFixture();
  assert.equal(
    (
      await new DeliveryVerifier(f.port, guard).verify(
        {} as ResolutionWitness,
        'Synthetic',
        { record: async () => {} },
        limits,
      )
    ).status,
    'FAILED',
  );
  const wrong = new FakeDeliveryPort({}, {});
  assert.equal(
    (
      await new DeliveryVerifier(wrong, guard).verify(
        f.witness,
        'Synthetic',
        { record: async () => {} },
        limits,
      )
    ).status,
    'FAILED',
  );
  assert.equal(f.port.armed, 0);
  assert.equal(wrong.armed, 0);
});
test('pre-boundary identity/ownership and invalid text fail with zero callback/click', async () => {
  for (const mode of ['owner', 'text', 'after-arm']) {
    const f = await verifiedFixture();
    let boundaries = 0;
    if (mode === 'owner') f.directory.owned = false;
    if (mode === 'after-arm')
      f.port.afterArm = () => {
        f.directory.owned = false;
      };
    const result = await new DeliveryVerifier(f.port, guard).verify(
      f.witness,
      mode === 'text' ? '' : 'Synthetic',
      {
        record: async () => {
          boundaries++;
        },
      },
      limits,
    );
    assert.equal(result.status, 'FAILED');
    assert.equal(boundaries, 0);
    assert.equal(f.port.clicks, 0);
    assert.equal(f.port.disposed, 1);
  }
});
test('uncertain persistence acknowledgement never clicks or becomes FAILED/retry', async () => {
  for (const mode of ['reject', 'hang']) {
    const f = await verifiedFixture();
    let boundaries = 0;
    const result = await new DeliveryVerifier(f.port, guard).verify(
      f.witness,
      'Synthetic',
      {
        record: async () => {
          boundaries++;
          if (mode === 'reject') throw new Error('sensitive raw failure');
          await new Promise(() => {});
        },
      },
      { ...limits, verificationTimeoutMs: 30 },
    );
    assert.equal(result.status, 'DELIVERY_UNKNOWN');
    assert.equal(result.boundary, 'UNCERTAIN');
    assert.equal(boundaries, 1);
    assert.equal(f.port.clicks, 0);
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  }
});
test('identity loss after recorded boundary prevents click but stays UNKNOWN', async () => {
  const f = await verifiedFixture();
  const result = await new DeliveryVerifier(f.port, guard).verify(
    f.witness,
    'Synthetic',
    {
      record: async () => {
        f.directory.owned = false;
      },
    },
    limits,
  );
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(result.boundary, 'RECORDED');
  assert.equal(f.port.clicks, 0);
});
test('click uncertainty, ambiguous evidence and timeout never retry', async () => {
  for (const mode of ['click-error', 'ambiguous', 'timeout']) {
    const f = await verifiedFixture();
    if (mode === 'click-error')
      f.port.afterClick = () => {
        throw new Error('possibly invoked');
      };
    if (mode === 'ambiguous') f.port.evidence = 'AMBIGUOUS';
    if (mode === 'timeout') f.port.evidence = 'PENDING';
    const verifier = new DeliveryVerifier(f.port, guard),
      boundary = { record: async () => {} };
    const result = await verifier.verify(f.witness, 'Synthetic', boundary, {
      ...limits,
      verificationTimeoutMs: 40,
    });
    assert.equal(result.status, 'DELIVERY_UNKNOWN');
    assert.equal(f.port.clicks, 1);
    assert.equal(f.port.disposed, 1);
    assert.deepEqual(await verifier.verify(f.witness, 'Synthetic', boundary, limits), result);
    assert.equal(f.port.clicks, 1);
    if (mode === 'timeout') assert.equal(f.port.reconciliations, 1);
  }
});
test('concurrent witness calls cannot persist or click twice', async () => {
  const f = await verifiedFixture();
  let release!: () => void,
    boundaries = 0;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const boundary = {
    record: async () => {
      boundaries++;
      await barrier;
    },
  };
  const verifier = new DeliveryVerifier(f.port, guard);
  const first = verifier.verify(f.witness, 'Synthetic', boundary, limits);
  const second = await verifier.verify(f.witness, 'Synthetic', boundary, limits);
  assert.equal(second.status, 'DELIVERY_UNKNOWN');
  release();
  assert.equal((await first).status, 'SUCCESS');
  assert.equal(boundaries, 1);
  assert.equal(f.port.clicks, 1);
});
test('target mutation during final evidence revalidation cannot publish SUCCESS', async () => {
  const f = await verifiedFixture();
  const observe = f.port.observe.bind(f.port);
  f.port.observe = async (budget) => {
    const value = await observe(budget);
    f.directory.owned = false;
    return value;
  };
  const result = await new DeliveryVerifier(f.port, guard).verify(
    f.witness,
    'Synthetic',
    { record: async () => {} },
    limits,
  );
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(f.port.clicks, 1);
});
test('unproven teardown is UNKNOWN and keeps the page reserved against another invocation', async () => {
  const f = await verifiedFixture();
  f.port.dispose = () => new Promise(() => {});
  const first = await new DeliveryVerifier(f.port, guard).verify(
    f.witness,
    'Synthetic',
    { record: async () => {} },
    { ...limits, verificationTimeoutMs: 1000 },
  );
  assert.equal(first.status, 'DELIVERY_UNKNOWN');
  assert.equal(f.port.clicks, 1);
  const next = await f.resolver.resolve(request(), Date.now() + 1000);
  if (next.status !== 'FOUND') throw new Error('fixture not found');
  const selected = await f.resolver.openAndVerify(next.candidate, request());
  if (selected.status !== 'VERIFIED') throw new Error('fixture not verified');
  const other = new FakeDeliveryPort(f.directory.state.page, f.directory.state.context);
  assert.equal(
    (
      await new DeliveryVerifier(other, guard).verify(
        selected.witness,
        'Synthetic',
        { record: async () => {} },
        limits,
      )
    ).status,
    'DELIVERY_UNKNOWN',
  );
  assert.equal(other.armed, 0);
  assert.equal(other.clicks, 0);
});
