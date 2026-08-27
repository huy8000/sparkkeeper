import { describe, expect, it } from 'vitest';

import {
  createTemplateDraft,
  keepStaticMessage,
  serializeTemplateDraft,
  toTemplateInput,
  transitionProvider,
  validateTemplateDraft,
} from './templateEditorModel';

describe('template editor model', () => {
  it('creates a blank Static draft without invented message content', () => {
    expect(createTemplateDraft()).toEqual({
      name: '',
      providerType: 'STATIC',
      messages: [''],
      enabled: true,
    });
  });

  it('preserves the existing message from Static to Random', () => {
    const draft = { ...createTemplateDraft(), messages: ['Message A'] };
    expect(transitionProvider(draft, 'RANDOM')).toEqual({
      kind: 'applied',
      draft: { ...draft, providerType: 'RANDOM' },
    });
  });

  it('preserves one Random message when switching to Static', () => {
    const draft = { ...createTemplateDraft(), providerType: 'RANDOM' as const, messages: ['A'] };
    expect(transitionProvider(draft, 'STATIC')).toEqual({
      kind: 'applied',
      draft: { ...draft, providerType: 'STATIC' },
    });
  });

  it('requires selection for a multi-message Random to Static transition', () => {
    const draft = {
      ...createTemplateDraft(),
      providerType: 'RANDOM' as const,
      messages: ['Message A', 'Message B'],
    };
    expect(transitionProvider(draft, 'STATIC')).toEqual({ kind: 'selection-required' });
    expect(keepStaticMessage(draft, 1)).toEqual({
      ...draft,
      providerType: 'STATIC',
      messages: ['Message B'],
    });
  });

  it('validates blank messages without changing intentional whitespace', () => {
    const invalid = {
      ...createTemplateDraft(),
      name: 'Demo',
      providerType: 'RANDOM' as const,
      messages: ['Message A', '   '],
    };
    expect(validateTemplateDraft(invalid).summary).toContain('Every configured message');

    const valid = { ...invalid, messages: ['  Message A  ', 'Message B'] };
    expect(validateTemplateDraft(valid).summary).toBe('');
    expect(toTemplateInput(valid).messages).toEqual(['  Message A  ', 'Message B']);
  });

  it('serializes candidate order as part of dirty state', () => {
    const first = { ...createTemplateDraft(), messages: ['Message A', 'Message B'] };
    const reordered = { ...first, messages: ['Message B', 'Message A'] };
    expect(serializeTemplateDraft(first)).not.toBe(serializeTemplateDraft(reordered));
  });
});
