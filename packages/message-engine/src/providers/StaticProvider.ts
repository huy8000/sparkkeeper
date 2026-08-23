import type { MessageTemplate } from '@sparkkeeper/shared';

import { validateTemplateForProvider } from '../validation.js';
import type { MessageProvider } from './MessageProvider.js';

export class StaticProvider implements MessageProvider {
  readonly type = 'STATIC' as const;

  async build(template: MessageTemplate): Promise<string> {
    validateTemplateForProvider(template, this.type);
    return template.messages[0] as string;
  }
}
