import type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

export interface MessageProvider {
  readonly type: MessageProviderType;
  build(template: MessageTemplate): Promise<string>;
}
