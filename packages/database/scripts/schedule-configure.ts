import { AccountRepository, createDatabase, ScheduleRepository } from '../src/index.js';

const [
  accountId,
  startTime,
  endTime,
  timezone = 'Asia/Shanghai',
  enabledValue = 'true',
  maxAttemptsValue = '3',
  retryIntervalSecondsValue = '60',
] = process.argv.slice(2);
if (accountId === undefined || startTime === undefined || endTime === undefined) {
  throw new Error(
    'Usage: schedule-configure.ts <account-id> <start-HH:mm> <end-HH:mm> [timezone] [true|false] [max-attempts] [retry-interval-seconds]',
  );
}
if (enabledValue !== 'true' && enabledValue !== 'false')
  throw new Error('Schedule enabled value must be true or false.');
const maxAttempts = Number(maxAttemptsValue);
const retryIntervalSeconds = Number(retryIntervalSecondsValue);

const client = createDatabase();
try {
  client.migrate();
  if (new AccountRepository(client).findById(accountId) === undefined)
    throw new Error('Explicit Account was not found.');
  const repository = new ScheduleRepository(client);
  const existing = repository.findByAccountId(accountId);
  const schedule =
    existing === undefined
      ? repository.create({
          accountId,
          startTime,
          endTime,
          timezone,
          enabled: enabledValue === 'true',
          maxAttempts,
          retryIntervalSeconds,
          now: new Date(),
        })
      : repository.update(existing.id, {
          startTime,
          endTime,
          timezone,
          enabled: enabledValue === 'true',
          maxAttempts,
          retryIntervalSeconds,
          now: new Date(),
        });
  console.log(JSON.stringify({ scheduleId: schedule?.id, accountId, configured: true }));
} finally {
  client.close();
}
