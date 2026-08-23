export interface SchedulerEnvironment {
  readonly SCHEDULER_ENABLED?: string;
  readonly SCHEDULER_ALLOW_REAL_SEND?: string;
  readonly SCHEDULER_ACCOUNT_ID?: string;
  readonly SCHEDULER_MESSAGE_TEMPLATE_ID?: string;
}

export interface SchedulerConfig {
  readonly enabled: boolean;
  readonly allowRealSend: boolean;
  readonly accountId: string | undefined;
  readonly messageTemplateId: string | undefined;
}

export function resolveSchedulerConfig(
  environment: SchedulerEnvironment = process.env,
): SchedulerConfig {
  const enabled = parseBoolean(environment.SCHEDULER_ENABLED, 'SCHEDULER_ENABLED');
  const allowRealSend = parseBoolean(
    environment.SCHEDULER_ALLOW_REAL_SEND,
    'SCHEDULER_ALLOW_REAL_SEND',
  );
  const accountId = optional(environment.SCHEDULER_ACCOUNT_ID);
  const messageTemplateId = optional(environment.SCHEDULER_MESSAGE_TEMPLATE_ID);
  if (enabled && accountId === undefined) {
    throw new Error('SCHEDULER_ACCOUNT_ID is required when Scheduler is enabled.');
  }
  if (enabled && allowRealSend && messageTemplateId === undefined) {
    throw new Error('SCHEDULER_MESSAGE_TEMPLATE_ID is required when real sending is authorized.');
  }
  return { enabled, allowRealSend, accountId, messageTemplateId };
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim() === '' || value.trim().toLowerCase() === 'false')
    return false;
  if (value.trim().toLowerCase() === 'true') return true;
  throw new Error(`${name} must be true or false.`);
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === '' ? undefined : normalized;
}
