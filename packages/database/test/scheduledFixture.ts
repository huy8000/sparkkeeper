import type { TestContext } from 'node:test';
import { ScheduledSendRepository } from '../src/index.js';
import type { TaskConfiguration } from '@sparkkeeper/shared';
import { testSendFixture } from './testSendFixture.js';
export function scheduledFixture(t: TestContext) {
  const f = testSendFixture(t);
  let now = new Date('2026-10-03T10:00:00.000Z');
  const repository = new ScheduledSendRepository(f.client, () => now);
  const configuration: TaskConfiguration = {
    name: 'Synthetic task',
    accountId: f.account.id,
    templateId: f.template.id,
    contactIds: [f.target.contact.id],
    schedule: {
      type: 'DAILY_WINDOW',
      startTime: '09:00',
      endTime: '12:00',
      timezone: 'UTC',
      maxAttempts: 3,
      retryIntervalSeconds: 1,
    },
  };
  const task = repository.tasks.create(configuration, f.admin.id, now);
  const enable = () =>
    repository.tasks.mutate(
      task.id,
      repository.tasks.row(task.id).updatedAt.toISOString(),
      f.admin.id,
      'enable',
      undefined,
      true,
      now,
    );
  const publish = () => {
    const prepared = repository.prepare(task.id);
    return repository.publish(
      task.id,
      prepared,
      prepared.targets.map(() => f.template.messages[0]!),
      now,
    );
  };
  return {
    ...f,
    repository,
    configuration,
    task,
    enable,
    publish,
    clock: () => now,
    setNow: (value: Date) => {
      now = value;
    },
  };
}
