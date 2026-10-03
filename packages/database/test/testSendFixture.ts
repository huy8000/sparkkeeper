import type { TestContext } from 'node:test';
import {
  AccountRepository,
  AdminUserRepository,
  ContactRepository,
  MessageTemplateRepository,
  TestSendRepository,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';
export function testSendFixture(t: TestContext) {
  const temp = createTemporaryDatabase(t);
  const account = new AccountRepository(temp.client).create({
    name: 'Synthetic Test Send',
    profileState: 'READY',
    loginStatus: 'READY',
    douyinSecUid: 'synthetic-self',
  });
  const admin = new AdminUserRepository(temp.client).create({
    username: 'fixture-test-send',
    passwordHash: 'fixture',
  });
  const contacts = new ContactRepository(temp.client);
  const target = contacts.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Synthetic target',
    initialIdentity: { kind: 'SEC_UID', value: 'Fixture-001', source: 'DOM' },
  });
  const templates = new MessageTemplateRepository(temp.client);
  const template = templates.create({
    name: 'Synthetic template',
    providerType: 'STATIC',
    messages: ['  Synthetic message\r\nexact  '],
  });
  const repository = new TestSendRepository(temp.client);
  const preview = repository.preview(
    account.id,
    target.contact.id,
    template.id,
    admin.id,
    'preview',
  );
  const consume = (key = 'execute') =>
    repository.consume(
      account.id,
      admin.id,
      preview.intentId,
      preview.payloadDigest,
      key,
      template.messages[0]!,
    );
  return {
    ...temp,
    account,
    admin,
    contacts,
    target,
    templates,
    template,
    repository,
    preview,
    consume,
  };
}
