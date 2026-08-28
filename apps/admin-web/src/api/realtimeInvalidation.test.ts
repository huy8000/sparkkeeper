import { describe, expect, it } from 'vitest';

import { RUN_ID } from '../test/fixtures';
import { configEvent, readyEvent, runtimeEvent } from '../test/realtime';
import { parseRealtimeEvent } from './realtimeClient';
import { invalidatesRuntimeStatus } from './realtimeInvalidation';

function parsed(value: unknown, type: 'RUNTIME_EVENT' | 'CONFIG_CHANGED' | 'READY') {
  return parseRealtimeEvent(JSON.stringify(value), type)!;
}

describe('runtime-status invalidation', () => {
  it('refreshes for meaningful lifecycle events but not arbitrary config or READY signals', () => {
    expect(
      invalidatesRuntimeStatus(parsed(runtimeEvent(RUN_ID, 'RUN_STARTED'), 'RUNTIME_EVENT')),
    ).toBe(true);
    expect(
      invalidatesRuntimeStatus(parsed(runtimeEvent(RUN_ID, 'MESSAGE_SENDING'), 'RUNTIME_EVENT')),
    ).toBe(false);
    expect(
      invalidatesRuntimeStatus(
        parsed(configEvent('NOTIFICATION', 'notification-config'), 'CONFIG_CHANGED'),
      ),
    ).toBe(false);
    expect(invalidatesRuntimeStatus(parsed(readyEvent(), 'READY'))).toBe(false);
  });
});
