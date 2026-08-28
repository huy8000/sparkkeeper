import type { MessageProviderType, MessageTemplateDetail, MessageTemplateInput } from './types/api';

export interface TemplateDraft {
  name: string;
  providerType: MessageProviderType;
  messages: string[];
  enabled: boolean;
}

export interface TemplateDraftErrors {
  readonly name: string;
  readonly messages: readonly string[];
  readonly summary: string;
}

export type ProviderTransition =
  | { readonly kind: 'applied'; readonly draft: TemplateDraft }
  | { readonly kind: 'selection-required' };

export function createTemplateDraft(template?: MessageTemplateDetail): TemplateDraft {
  return template === undefined
    ? { name: '', providerType: 'STATIC', messages: [''], enabled: true }
    : {
        name: template.name,
        providerType: template.providerType,
        messages: [...template.messages],
        enabled: template.enabled,
      };
}

export function serializeTemplateDraft(draft: TemplateDraft): string {
  return JSON.stringify({
    name: draft.name,
    providerType: draft.providerType,
    messages: draft.messages,
    enabled: draft.enabled,
  });
}

export function transitionProvider(
  draft: TemplateDraft,
  providerType: MessageProviderType,
): ProviderTransition {
  if (providerType === draft.providerType) return { kind: 'applied', draft: cloneDraft(draft) };
  if (providerType === 'RANDOM' || draft.messages.length === 1) {
    return { kind: 'applied', draft: { ...cloneDraft(draft), providerType } };
  }
  return { kind: 'selection-required' };
}

export function keepStaticMessage(draft: TemplateDraft, index: number): TemplateDraft {
  const message = draft.messages[index];
  if (message === undefined) return cloneDraft(draft);
  return { ...cloneDraft(draft), providerType: 'STATIC', messages: [message] };
}

export function validateTemplateDraft(draft: TemplateDraft): TemplateDraftErrors {
  const name = draft.name.trim().length === 0 ? 'templateEditor.validation.nameRequired' : '';
  const messages = draft.messages.map((message) =>
    message.trim().length === 0 ? 'templateEditor.validation.messageRequired' : '',
  );
  let summary = '';
  if (draft.providerType === 'STATIC' && draft.messages.length !== 1) {
    summary = 'templateEditor.validation.staticExactlyOne';
  } else if (draft.messages.length === 0) {
    summary = 'templateEditor.validation.atLeastOne';
  } else if (messages.some((message) => message !== '')) {
    summary = 'templateEditor.validation.allMessagesRequired';
  }
  return { name, messages, summary };
}

export function toTemplateInput(draft: TemplateDraft): MessageTemplateInput {
  return {
    name: draft.name.trim(),
    providerType: draft.providerType,
    messages: [...draft.messages],
    enabled: draft.enabled,
  };
}

function cloneDraft(draft: TemplateDraft): TemplateDraft {
  return { ...draft, messages: [...draft.messages] };
}
