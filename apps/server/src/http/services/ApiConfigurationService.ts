import {
  type AccountRepository,
  type CreateFriendInput,
  FriendIdentityError,
  type FriendRepository,
  type MessageTemplateRepository,
  normalizeFriendIdentity,
  type ScheduleRepository,
  type ScheduleRepositoryError,
  selectFriendMatch,
  type UpdateFriendInput,
} from '@sparkkeeper/database';
import {
  MessageTemplateValidationError,
  validateTemplateMessages,
  validateTemplateName,
} from '@sparkkeeper/message-engine';
import type { FriendMatchField, MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

import { ApiError, entityNotFound } from '../errors/ApiError.js';
import {
  type AccountDto,
  type FriendDto,
  type ScheduleDto,
  toAccountDto,
  toFriendDto,
  toScheduleDto,
} from './ApiEntityDtos.js';

export interface MessageTemplateSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messageCount: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageTemplateDetailDto extends MessageTemplateSummaryDto {
  readonly messages: readonly string[];
}

export interface CreateAccountConfigInput {
  readonly name: string;
  readonly enabled?: boolean;
}

export interface UpdateAccountConfigInput {
  readonly name?: string;
  readonly enabled?: boolean;
}

export interface FriendConfigInput {
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
  readonly matchField?: FriendMatchField;
  readonly enabled?: boolean;
}

export interface UpdateFriendConfigInput extends Omit<Partial<FriendConfigInput>, 'displayName'> {
  readonly displayName?: string;
}

export interface TemplateConfigInput {
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messages: readonly string[];
  readonly enabled?: boolean;
}

export interface UpdateTemplateConfigInput {
  readonly name?: string;
  readonly providerType?: MessageProviderType;
  readonly messages?: readonly string[];
  readonly enabled?: boolean;
}

export interface ConfigureScheduleInput {
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryIntervalSeconds: number;
}

export interface ApiConfigurationRepositories {
  readonly accounts: Pick<AccountRepository, 'create' | 'findById' | 'update'>;
  readonly friends: Pick<FriendRepository, 'create' | 'findById' | 'update'>;
  readonly schedules: Pick<ScheduleRepository, 'create' | 'findByAccountId' | 'update'>;
  readonly templates: Pick<MessageTemplateRepository, 'create' | 'findById' | 'list' | 'update'>;
}

export class ApiConfigurationService {
  constructor(
    private readonly repositories: ApiConfigurationRepositories,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  createAccount(input: CreateAccountConfigInput): AccountDto {
    const name = validatedName(input.name, 'Account');
    return toAccountDto(
      this.repositories.accounts.create({
        name,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      }),
    );
  }

  updateAccount(accountId: string, input: UpdateAccountConfigInput): AccountDto {
    const update = {
      ...(input.name === undefined ? {} : { name: validatedName(input.name, 'Account') }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    const account = this.repositories.accounts.update(accountId, update);
    if (account === undefined) throw entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    return toAccountDto(account);
  }

  createFriend(accountId: string, input: FriendConfigInput): FriendDto {
    this.requireAccount(accountId);
    validateFriendConfiguration(input, input.matchField);
    const create: CreateFriendInput = { accountId, ...input };
    return toFriendDto(this.repositories.friends.create(create));
  }

  updateFriend(friendId: string, input: UpdateFriendConfigInput): FriendDto {
    const existing = this.repositories.friends.findById(friendId);
    if (existing === undefined) throw entityNotFound('FRIEND_NOT_FOUND', 'Friend');
    validateFriendConfiguration(
      {
        displayName: input.displayName ?? existing.displayName,
        remarkName: input.remarkName === undefined ? existing.remarkName : input.remarkName,
        shortId: input.shortId === undefined ? existing.shortId : input.shortId,
        uniqueId: input.uniqueId === undefined ? existing.uniqueId : input.uniqueId,
        secUid: input.secUid === undefined ? existing.secUid : input.secUid,
      },
      input.matchField ?? existing.matchField,
    );
    const repositoryInput: UpdateFriendInput = {
      ...input,
      ...(input.matchField === undefined && hasFriendIdentityChange(input)
        ? { matchField: existing.matchField }
        : {}),
    };
    const friend = this.repositories.friends.update(friendId, repositoryInput);
    if (friend === undefined) throw entityNotFound('FRIEND_NOT_FOUND', 'Friend');
    return toFriendDto(friend);
  }

  listTemplates(): MessageTemplateSummaryDto[] {
    return this.repositories.templates.list().map(toTemplateSummaryDto);
  }

  getTemplate(templateId: string): MessageTemplateDetailDto {
    const template = this.repositories.templates.findById(templateId);
    if (template === undefined) throw entityNotFound('TEMPLATE_NOT_FOUND', 'Message template');
    return toTemplateDetailDto(template);
  }

  createTemplate(input: TemplateConfigInput): MessageTemplateDetailDto {
    validateTemplateConfiguration(input.name, input.providerType, input.messages);
    return toTemplateDetailDto(this.repositories.templates.create(input));
  }

  updateTemplate(templateId: string, input: UpdateTemplateConfigInput): MessageTemplateDetailDto {
    const existing = this.repositories.templates.findById(templateId);
    if (existing === undefined) throw entityNotFound('TEMPLATE_NOT_FOUND', 'Message template');
    validateTemplateConfiguration(
      input.name ?? existing.name,
      input.providerType ?? existing.providerType,
      input.messages ?? existing.messages,
    );
    const template = this.repositories.templates.update(templateId, input);
    if (template === undefined) throw entityNotFound('TEMPLATE_NOT_FOUND', 'Message template');
    return toTemplateDetailDto(template);
  }

  configureSchedule(accountId: string, input: ConfigureScheduleInput): ScheduleDto {
    this.requireAccount(accountId);
    const existing = this.repositories.schedules.findByAccountId(accountId);
    try {
      const schedule =
        existing === undefined
          ? this.repositories.schedules.create({ accountId, ...input, now: this.clock() })
          : this.repositories.schedules.update(existing.id, { ...input, now: this.clock() });
      if (schedule === undefined) throw entityNotFound('SCHEDULE_NOT_FOUND', 'Schedule');
      return toScheduleDto(schedule);
    } catch (error) {
      throw mapScheduleError(error);
    }
  }

  private requireAccount(accountId: string): void {
    if (this.repositories.accounts.findById(accountId) === undefined) {
      throw entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    }
  }
}

function hasFriendIdentityChange(input: UpdateFriendConfigInput): boolean {
  return (
    input.displayName !== undefined ||
    input.remarkName !== undefined ||
    input.shortId !== undefined ||
    input.uniqueId !== undefined ||
    input.secUid !== undefined
  );
}

function validatedName(value: string, entity: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${entity} name must not be empty.`);
  }
  return name;
}

function validateFriendConfiguration(
  identityInput: {
    readonly displayName: string;
    readonly remarkName?: string | null;
    readonly shortId?: string | null;
    readonly uniqueId?: string | null;
    readonly secUid?: string | null;
  },
  matchField?: FriendMatchField,
): void {
  try {
    const identity = normalizeFriendIdentity(identityInput);
    selectFriendMatch(identity, matchField);
  } catch (error) {
    if (error instanceof FriendIdentityError) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Friend identity configuration is invalid.');
    }
    throw error;
  }
}

function validateTemplateConfiguration(
  name: string,
  providerType: MessageProviderType,
  messages: readonly string[],
): void {
  try {
    validateTemplateName(name);
    validateTemplateMessages(providerType, messages);
  } catch (error) {
    if (error instanceof MessageTemplateValidationError) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Message template configuration is invalid.');
    }
    throw error;
  }
}

function mapScheduleError(error: unknown): unknown {
  if (isScheduleRepositoryError(error)) {
    if (error.code === 'ACCOUNT_NOT_FOUND') {
      return entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    }
    if (error.code !== 'DATABASE_OPERATION_FAILED' && error.code !== 'INVALID_TIMESTAMP') {
      return new ApiError(400, 'VALIDATION_ERROR', 'Schedule configuration is invalid.');
    }
    if (hasSqliteUniqueConstraint(error)) {
      return new ApiError(409, 'CONFLICT', 'Schedule configuration conflicts with existing data.');
    }
  }
  return error;
}

function hasSqliteUniqueConstraint(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    const code = 'code' in current ? current.code : undefined;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    current = current.cause;
  }
  return false;
}

function isScheduleRepositoryError(error: unknown): error is ScheduleRepositoryError {
  return (
    error instanceof Error &&
    error.name === 'ScheduleRepositoryError' &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

function toTemplateSummaryDto(template: MessageTemplate): MessageTemplateSummaryDto {
  return {
    id: template.id,
    name: template.name,
    providerType: template.providerType,
    messageCount: template.messages.length,
    enabled: template.enabled,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toTemplateDetailDto(template: MessageTemplate): MessageTemplateDetailDto {
  return { ...toTemplateSummaryDto(template), messages: [...template.messages] };
}
