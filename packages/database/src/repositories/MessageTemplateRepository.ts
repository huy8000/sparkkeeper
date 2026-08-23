import { randomUUID } from 'node:crypto';

import {
  MessageTemplateValidationError,
  validateProviderType,
  validateTemplateMessages,
  validateTemplateName,
} from '@sparkkeeper/message-engine';
import type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';
import { asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  messageTemplates,
  type MessageTemplateRow,
  type NewMessageTemplateRow,
} from '../schema/index.js';

export interface CreateMessageTemplateInput {
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messages: readonly string[];
  readonly enabled?: boolean;
}

export interface UpdateMessageTemplateInput {
  readonly name?: string;
  readonly providerType?: MessageProviderType;
  readonly messages?: readonly string[];
  readonly enabled?: boolean;
}

export class MessageTemplateRepositoryError extends Error {
  readonly operation: 'create' | 'findById' | 'list' | 'listEnabled' | 'update';

  constructor(
    operation: MessageTemplateRepositoryError['operation'],
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MessageTemplateRepositoryError';
    this.operation = operation;
  }
}

export class MessageTemplateDataError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MessageTemplateDataError';
  }
}

export class MessageTemplateRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateMessageTemplateInput): MessageTemplate {
    try {
      const name = validateTemplateName(input.name);
      validateTemplateMessages(input.providerType, input.messages);
      const now = new Date();
      const values: NewMessageTemplateRow = {
        id: randomUUID(),
        name,
        providerType: input.providerType,
        content: serializeMessages(input.messages),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };

      return mapMessageTemplateRow(
        this.client.orm.insert(messageTemplates).values(values).returning().get(),
      );
    } catch (error) {
      throw repositoryError('create', 'Failed to create message template.', error);
    }
  }

  findById(id: string): MessageTemplate | undefined {
    try {
      const row = this.client.orm
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.id, id))
        .get();
      return row === undefined ? undefined : mapMessageTemplateRow(row);
    } catch (error) {
      throw repositoryError('findById', 'Failed to find message template by id.', error);
    }
  }

  list(): MessageTemplate[] {
    try {
      return this.client.orm
        .select()
        .from(messageTemplates)
        .orderBy(asc(messageTemplates.createdAt), asc(messageTemplates.id))
        .all()
        .map(mapMessageTemplateRow);
    } catch (error) {
      throw repositoryError('list', 'Failed to list message templates.', error);
    }
  }

  listEnabled(): MessageTemplate[] {
    try {
      return this.client.orm
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.enabled, true))
        .orderBy(asc(messageTemplates.createdAt), asc(messageTemplates.id))
        .all()
        .map(mapMessageTemplateRow);
    } catch (error) {
      throw repositoryError('listEnabled', 'Failed to list enabled message templates.', error);
    }
  }

  update(id: string, input: UpdateMessageTemplateInput): MessageTemplate | undefined {
    try {
      const row = this.client.orm
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.id, id))
        .get();
      if (row === undefined) {
        return undefined;
      }

      const existing = mapMessageTemplateRow(row);
      const hasTemplateChange = input.providerType !== undefined || input.messages !== undefined;
      const mutableFieldCount =
        Number(input.name !== undefined) +
        Number(hasTemplateChange) +
        Number(input.enabled !== undefined);
      if (mutableFieldCount === 0) {
        throw new MessageTemplateRepositoryError(
          'update',
          'Message template update requires at least one field.',
        );
      }

      const values: Partial<NewMessageTemplateRow> = { updatedAt: new Date() };
      if (input.name !== undefined) {
        values.name = validateTemplateName(input.name);
      }
      if (input.enabled !== undefined) {
        values.enabled = input.enabled;
      }
      if (hasTemplateChange) {
        const providerType = input.providerType ?? existing.providerType;
        const messages = input.messages ?? existing.messages;
        validateTemplateMessages(providerType, messages);
        values.providerType = providerType;
        values.content = serializeMessages(messages);
      }

      const updated = this.client.orm
        .update(messageTemplates)
        .set(values)
        .where(eq(messageTemplates.id, id))
        .returning()
        .get();
      return updated === undefined ? undefined : mapMessageTemplateRow(updated);
    } catch (error) {
      throw repositoryError('update', 'Failed to update message template.', error);
    }
  }
}

function serializeMessages(messages: readonly string[]): string {
  return JSON.stringify(messages);
}

function mapMessageTemplateRow(row: MessageTemplateRow): MessageTemplate {
  let messages: unknown;
  try {
    messages = JSON.parse(row.content) as unknown;
  } catch (error) {
    throw new MessageTemplateDataError('Stored message template content is not valid JSON.', error);
  }

  const providerType: unknown = row.providerType;
  try {
    const name = validateTemplateName(row.name);
    validateProviderType(providerType);
    validateTemplateMessages(providerType, messages);
    return {
      id: row.id,
      name,
      providerType,
      messages: [...messages],
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    throw new MessageTemplateDataError('Stored message template data is invalid.', error);
  }
}

function repositoryError(
  operation: MessageTemplateRepositoryError['operation'],
  fallbackMessage: string,
  error: unknown,
): MessageTemplateRepositoryError | MessageTemplateDataError {
  if (
    error instanceof MessageTemplateRepositoryError ||
    error instanceof MessageTemplateDataError
  ) {
    return error;
  }
  if (error instanceof MessageTemplateValidationError) {
    return new MessageTemplateRepositoryError(operation, error.message, error);
  }
  return new MessageTemplateRepositoryError(operation, fallbackMessage, error);
}
