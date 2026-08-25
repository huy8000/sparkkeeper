import type { MessageTemplate } from '@sparkkeeper/shared';

import { validateTemplateForProvider } from '../validation.js';
import type { MessageProvider } from './MessageProvider.js';

export type RandomSource = () => number;

export class RandomSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RandomSourceError';
  }
}

export class RandomProvider implements MessageProvider {
  readonly type = 'RANDOM' as const;

  constructor(private readonly randomSource: RandomSource = Math.random) {}

  async build(template: MessageTemplate): Promise<string> {
    validateTemplateForProvider(template, this.type);

    const randomValue = this.randomSource();
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RandomSourceError('Random source must return a finite value in the range [0, 1).');
    }

    const index = Math.floor(randomValue * template.messages.length);
    return template.messages[index] as string;
  }
}
