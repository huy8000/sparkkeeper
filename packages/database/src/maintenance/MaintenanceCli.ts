import type { FriendMatchField, MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { FRIEND_MATCH_FIELDS } from '../identity/index.js';
import { AccountRepository } from '../repositories/AccountRepository.js';
import { FriendRepository, type Friend } from '../repositories/FriendRepository.js';
import { MessageTemplateRepository } from '../repositories/MessageTemplateRepository.js';
import { ScheduleRepository, type Schedule } from '../repositories/ScheduleRepository.js';

export interface AccountMaintenanceOutput {
  readonly entity: 'Account';
  readonly action: 'CREATED' | 'UPDATED';
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly loginStatus: string;
}

export interface AccountListMaintenanceOutput {
  readonly entity: 'Account';
  readonly action: 'LISTED';
  readonly accounts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly loginStatus: string;
  }>;
}

export interface FriendMaintenanceOutput {
  readonly entity: 'Friend';
  readonly action: 'CREATED' | 'UPDATED';
  readonly id: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly matchField: FriendMatchField;
  readonly enabled: boolean;
}

export interface FriendListMaintenanceOutput {
  readonly entity: 'Friend';
  readonly action: 'LISTED';
  readonly accountId: string;
  readonly friends: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly matchField: FriendMatchField;
    readonly enabled: boolean;
  }>;
}

export interface MessageTemplateMaintenanceOutput {
  readonly entity: 'MessageTemplate';
  readonly action: 'CREATED' | 'UPDATED';
  readonly id: string;
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messageCount: number;
  readonly enabled: boolean;
}

export interface MessageTemplateListMaintenanceOutput {
  readonly entity: 'MessageTemplate';
  readonly action: 'LISTED';
  readonly templates: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly providerType: MessageProviderType;
    readonly messageCount: number;
    readonly enabled: boolean;
  }>;
}

export interface ScheduleMaintenanceOutput {
  readonly entity: 'Schedule';
  readonly action: 'CONFIGURED';
  readonly id: string;
  readonly accountId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryIntervalSeconds: number;
}

export type MaintenanceOutput =
  | AccountMaintenanceOutput
  | AccountListMaintenanceOutput
  | FriendMaintenanceOutput
  | FriendListMaintenanceOutput
  | MessageTemplateMaintenanceOutput
  | MessageTemplateListMaintenanceOutput
  | ScheduleMaintenanceOutput;

export class MaintenanceCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaintenanceCommandError';
  }
}

export function executeMaintenanceCommand(
  client: DatabaseClient,
  args: readonly string[],
): MaintenanceOutput {
  const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
  const [entity, action, ...optionArgs] = normalizedArgs;
  if (entity === 'schedule') {
    return executeScheduleCommand(client, action, optionArgs);
  }
  if (entity === 'template') {
    return executeMessageTemplateCommand(client, action, optionArgs);
  }
  if (entity === 'friend') {
    return executeFriendCommand(client, action, optionArgs);
  }
  if (entity !== 'account') {
    throw new MaintenanceCommandError('Unsupported maintenance entity.');
  }
  const repository = new AccountRepository(client);
  if (action === 'list') {
    if (optionArgs.length !== 0) {
      throw new MaintenanceCommandError('Account list does not accept options.');
    }
    return {
      entity: 'Account',
      action: 'LISTED',
      accounts: repository.list().map(({ id, name, enabled, loginStatus }) => ({
        id,
        name,
        enabled,
        loginStatus,
      })),
    };
  }
  if (action === 'set-enabled') {
    const options = parseOptions(optionArgs);
    assertOnlyOptions(options, ['id', 'enabled']);
    const id = requiredOption(options, 'id');
    const account = repository.update(id, {
      enabled: parseBooleanOption(requiredOption(options, 'enabled'), 'enabled'),
    });
    if (account === undefined) {
      throw new MaintenanceCommandError('Account was not found.');
    }
    return {
      entity: 'Account',
      action: 'UPDATED',
      id: account.id,
      name: account.name,
      enabled: account.enabled,
      loginStatus: account.loginStatus,
    };
  }
  if (action !== 'create') {
    throw new MaintenanceCommandError('Unsupported Account maintenance action.');
  }
  const options = parseOptions(optionArgs);
  assertOnlyOptions(options, ['name', 'enabled']);
  const name = requiredOption(options, 'name');
  const enabled = optionalOption(options, 'enabled');
  const account = repository.create({
    name,
    ...(enabled === undefined ? {} : { enabled: parseBooleanOption(enabled, 'enabled') }),
  });
  return {
    entity: 'Account',
    action: 'CREATED',
    id: account.id,
    name: account.name,
    enabled: account.enabled,
    loginStatus: account.loginStatus,
  };
}

function executeScheduleCommand(
  client: DatabaseClient,
  action: string | undefined,
  optionArgs: readonly string[],
): ScheduleMaintenanceOutput {
  if (action !== 'configure') {
    throw new MaintenanceCommandError('Unsupported Schedule maintenance action.');
  }
  const options = parseOptions(optionArgs);
  assertOnlyOptions(options, [
    'account-id',
    'start-time',
    'end-time',
    'timezone',
    'enabled',
    'max-attempts',
    'retry-interval-seconds',
  ]);
  const accountId = requiredOption(options, 'account-id');
  const repository = new ScheduleRepository(client);
  const existing = repository.findByAccountId(accountId);
  const input = {
    startTime: requiredOption(options, 'start-time'),
    endTime: requiredOption(options, 'end-time'),
    timezone: optionalOption(options, 'timezone') ?? 'Asia/Shanghai',
    enabled: parseBooleanOption(optionalOption(options, 'enabled') ?? 'true', 'enabled'),
    maxAttempts: parseIntegerOption(optionalOption(options, 'max-attempts') ?? '3', 'max-attempts'),
    retryIntervalSeconds: parseIntegerOption(
      optionalOption(options, 'retry-interval-seconds') ?? '60',
      'retry-interval-seconds',
    ),
    now: new Date(),
  };
  const schedule =
    existing === undefined
      ? repository.create({ accountId, ...input })
      : repository.update(existing.id, input);
  if (schedule === undefined) {
    throw new MaintenanceCommandError('Schedule update did not find its existing record.');
  }
  return scheduleOutput(schedule);
}

function scheduleOutput(schedule: Schedule): ScheduleMaintenanceOutput {
  return {
    entity: 'Schedule',
    action: 'CONFIGURED',
    id: schedule.id,
    accountId: schedule.accountId,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    maxAttempts: schedule.maxAttempts,
    retryIntervalSeconds: schedule.retryIntervalSeconds,
  };
}

function executeMessageTemplateCommand(
  client: DatabaseClient,
  action: string | undefined,
  optionArgs: readonly string[],
): MessageTemplateMaintenanceOutput | MessageTemplateListMaintenanceOutput {
  const repository = new MessageTemplateRepository(client);
  if (action === 'list') {
    if (optionArgs.length !== 0) {
      throw new MaintenanceCommandError('MessageTemplate list does not accept options.');
    }
    return {
      entity: 'MessageTemplate',
      action: 'LISTED',
      templates: repository.list().map(({ id, name, providerType, messages, enabled }) => ({
        id,
        name,
        providerType,
        messageCount: messages.length,
        enabled,
      })),
    };
  }
  if (action === 'update' || action === 'set-enabled') {
    const options = parseOptions(optionArgs);
    assertOnlyOptions(options, ['id', 'name', 'provider', 'message', 'enabled']);
    const id = requiredOption(options, 'id');
    const name = optionalOption(options, 'name');
    const provider = optionalOption(options, 'provider');
    const messages = options.get('message');
    const enabled = optionalOption(options, 'enabled');
    const template = repository.update(id, {
      ...(name === undefined ? {} : { name }),
      ...(provider === undefined ? {} : { providerType: parseProviderType(provider) }),
      ...(messages === undefined ? {} : { messages }),
      ...(enabled === undefined ? {} : { enabled: parseBooleanOption(enabled, 'enabled') }),
    });
    if (template === undefined) {
      throw new MaintenanceCommandError('MessageTemplate was not found.');
    }
    return templateOutput(template, 'UPDATED');
  }
  if (action !== 'create') {
    throw new MaintenanceCommandError('Unsupported MessageTemplate maintenance action.');
  }
  const options = parseOptions(optionArgs);
  assertOnlyOptions(options, ['name', 'provider', 'message', 'enabled']);
  const template = repository.create({
    name: requiredOption(options, 'name'),
    providerType: parseProviderType(requiredOption(options, 'provider')),
    messages: requiredOptions(options, 'message'),
    ...(optionalOption(options, 'enabled') === undefined
      ? {}
      : { enabled: parseBooleanOption(requiredOption(options, 'enabled'), 'enabled') }),
  });
  return templateOutput(template, 'CREATED');
}

function templateOutput(
  template: MessageTemplate,
  action: MessageTemplateMaintenanceOutput['action'],
): MessageTemplateMaintenanceOutput {
  return {
    entity: 'MessageTemplate',
    action,
    id: template.id,
    name: template.name,
    providerType: template.providerType,
    messageCount: template.messages.length,
    enabled: template.enabled,
  };
}

function executeFriendCommand(
  client: DatabaseClient,
  action: string | undefined,
  optionArgs: readonly string[],
): FriendMaintenanceOutput | FriendListMaintenanceOutput {
  const options = parseOptions(optionArgs);
  const repository = new FriendRepository(client);
  if (action === 'list') {
    assertOnlyOptions(options, ['account-id']);
    const accountId = requiredOption(options, 'account-id');
    return {
      entity: 'Friend',
      action: 'LISTED',
      accountId,
      friends: repository
        .listByAccountId(accountId)
        .map(({ id, displayName, matchField, enabled }) => ({
          id,
          displayName,
          matchField,
          enabled,
        })),
    };
  }
  if (action === 'update' || action === 'set-enabled') {
    assertOnlyOptions(options, [
      'id',
      'display-name',
      'remark-name',
      'short-id',
      'unique-id',
      'sec-uid',
      'match-field',
      'enabled',
    ]);
    const id = requiredOption(options, 'id');
    const displayName = optionalOption(options, 'display-name');
    const remarkName = optionalOption(options, 'remark-name');
    const shortId = optionalOption(options, 'short-id');
    const uniqueId = optionalOption(options, 'unique-id');
    const secUid = optionalOption(options, 'sec-uid');
    const matchField = optionalOption(options, 'match-field');
    const enabled = optionalOption(options, 'enabled');
    const friend = repository.update(id, {
      ...(displayName === undefined ? {} : { displayName }),
      ...(remarkName === undefined ? {} : { remarkName }),
      ...(shortId === undefined ? {} : { shortId }),
      ...(uniqueId === undefined ? {} : { uniqueId }),
      ...(secUid === undefined ? {} : { secUid }),
      ...(matchField === undefined ? {} : { matchField: parseMatchField(matchField) }),
      ...(enabled === undefined ? {} : { enabled: parseBooleanOption(enabled, 'enabled') }),
    });
    if (friend === undefined) {
      throw new MaintenanceCommandError('Friend was not found.');
    }
    return friendOutput(friend, 'UPDATED');
  }
  if (action !== 'create') {
    throw new MaintenanceCommandError('Unsupported Friend maintenance action.');
  }
  assertOnlyOptions(options, [
    'account-id',
    'display-name',
    'remark-name',
    'short-id',
    'unique-id',
    'sec-uid',
    'match-field',
    'enabled',
  ]);
  const accountId = requiredOption(options, 'account-id');
  if (new AccountRepository(client).findById(accountId) === undefined) {
    throw new MaintenanceCommandError('Explicit Account was not found.');
  }
  const matchFieldValue = optionalOption(options, 'match-field');
  const remarkName = optionalOption(options, 'remark-name');
  const shortId = optionalOption(options, 'short-id');
  const uniqueId = optionalOption(options, 'unique-id');
  const secUid = optionalOption(options, 'sec-uid');
  const enabled = optionalOption(options, 'enabled');
  const friend = repository.create({
    accountId,
    displayName: requiredOption(options, 'display-name'),
    ...(remarkName === undefined ? {} : { remarkName }),
    ...(shortId === undefined ? {} : { shortId }),
    ...(uniqueId === undefined ? {} : { uniqueId }),
    ...(secUid === undefined ? {} : { secUid }),
    ...(matchFieldValue === undefined ? {} : { matchField: parseMatchField(matchFieldValue) }),
    ...(enabled === undefined ? {} : { enabled: parseBooleanOption(enabled, 'enabled') }),
  });
  return friendOutput(friend, 'CREATED');
}

function friendOutput(
  friend: Friend,
  action: FriendMaintenanceOutput['action'],
): FriendMaintenanceOutput {
  return {
    entity: 'Friend',
    action,
    id: friend.id,
    accountId: friend.accountId,
    displayName: friend.displayName,
    matchField: friend.matchField,
    enabled: friend.enabled,
  };
}

function parseOptions(args: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new MaintenanceCommandError('Options must use --name value pairs.');
    }
    const name = flag.slice(2);
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return options;
}

function assertOnlyOptions(
  options: ReadonlyMap<string, readonly string[]>,
  allowed: readonly string[],
): void {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) {
      throw new MaintenanceCommandError(`Unsupported option: --${name}.`);
    }
  }
}

function requiredOption(options: ReadonlyMap<string, readonly string[]>, name: string): string {
  const values = options.get(name);
  if (values?.length !== 1 || values[0] === undefined) {
    throw new MaintenanceCommandError(`--${name} is required exactly once.`);
  }
  return values[0];
}

function requiredOptions(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): readonly string[] {
  const values = options.get(name);
  if (values === undefined || values.length === 0) {
    throw new MaintenanceCommandError(`--${name} is required.`);
  }
  return values;
}

function optionalOption(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): string | undefined {
  const values = options.get(name);
  if (values === undefined) return undefined;
  if (values.length !== 1 || values[0] === undefined) {
    throw new MaintenanceCommandError(`--${name} may be supplied at most once.`);
  }
  return values[0];
}

function parseMatchField(value: string): FriendMatchField {
  if (!FRIEND_MATCH_FIELDS.includes(value as FriendMatchField)) {
    throw new MaintenanceCommandError(
      `--match-field must be one of: ${FRIEND_MATCH_FIELDS.join(', ')}.`,
    );
  }
  return value as FriendMatchField;
}

function parseProviderType(value: string): MessageProviderType {
  if (value !== 'STATIC' && value !== 'RANDOM') {
    throw new MaintenanceCommandError('--provider must be STATIC or RANDOM.');
  }
  return value;
}

function parseBooleanOption(value: string, name: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new MaintenanceCommandError(`--${name} must be true or false.`);
}

function parseIntegerOption(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new MaintenanceCommandError(`--${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new MaintenanceCommandError(`--${name} must be a safe integer.`);
  }
  return parsed;
}
