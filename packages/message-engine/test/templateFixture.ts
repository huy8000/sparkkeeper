import type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

export function createTemplate(
  providerType: MessageProviderType,
  messages: readonly string[],
  overrides: Partial<MessageTemplate> = {},
): MessageTemplate {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'test-template-id',
    name: 'Test Template',
    providerType,
    messages,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}
