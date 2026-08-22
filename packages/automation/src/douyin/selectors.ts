export interface AuthCssSignal {
  readonly selector: string;
  readonly label: string;
}

export const DOUYIN_CHAT_URL = 'https://www.douyin.com/chat';

export const READY_CHAT_SHELL_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '[aria-label*="会话列表"]', label: 'conversation list aria-label' },
  { selector: '[aria-label*="聊天列表"]', label: 'chat list aria-label' },
  {
    selector: '[role="navigation"][aria-label*="消息"]',
    label: 'message navigation landmark',
  },
  { selector: '[data-e2e="chat-list"]', label: 'chat list data-e2e' },
  { selector: '[data-testid="conversation-list"]', label: 'conversation list test id' },
  { selector: '[data-e2e="conversation-item"]', label: 'conversation item data-e2e' },
  {
    selector: '[class~="conversationConversationListwrapper"]',
    label: 'conversation list semantic class',
  },
];

export const READY_CHAT_SHELL_TEXTS = ['消息', '私信'] as const;

export const READY_CHAT_WORKSPACE_SELECTORS: readonly AuthCssSignal[] = [
  {
    selector: '[class~="componentsRightPanelwrapper"]',
    label: 'chat right-panel semantic class',
  },
  {
    selector: '[contenteditable="true"][role="textbox"][aria-label*="消息"]',
    label: 'accessible message composer',
  },
  {
    selector: 'textarea[placeholder*="发送消息"]',
    label: 'send-message textarea',
  },
  {
    selector: 'textarea[placeholder*="回复"]',
    label: 'reply textarea',
  },
  {
    selector: '[role="textbox"][aria-label*="发送"]',
    label: 'send textbox aria-label',
  },
];

export const AUTH_MODE_TEXTS = ['扫码登录', '验证码登录', '密码登录', '手机号登录'] as const;

export const REAUTHENTICATION_TEXTS = [
  '重新登录',
  '请重新登录',
  '登录已失效',
  '登录状态已失效',
  '请重新认证',
] as const;

export const AUTH_SUPPORT_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '[aria-label*="二维码"]', label: 'QR-code aria-label' },
  { selector: 'img[alt*="二维码"]', label: 'QR-code image alt' },
  { selector: 'input[placeholder*="手机号"]', label: 'phone-number input' },
  { selector: 'input[placeholder*="验证码"]', label: 'verification-code input' },
  { selector: 'input[aria-label*="国家/地区"]', label: 'country or region input' },
];

export const ABNORMAL_PAGE_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '#main-frame-error', label: 'Chromium network error page' },
  { selector: '[data-error-code]', label: 'browser error code' },
];

export const ABNORMAL_PAGE_TEXTS = [
  '网络异常',
  '加载失败',
  '页面出错',
  '无法访问此网站',
  '请检查您的网络连接',
] as const;

export const CHAT_SHELL_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '[data-testid="chat-shell"]', label: 'chat shell test id' },
  { selector: '[class~="imContainer"]', label: 'Douyin IM shell semantic class' },
];

export const CONVERSATION_LIST_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '[aria-label*="会话列表"]', label: 'conversation list aria-label' },
  { selector: '[aria-label*="聊天列表"]', label: 'chat list aria-label' },
  { selector: '[data-e2e="chat-list"]', label: 'chat list data-e2e' },
  { selector: '[data-testid="conversation-list"]', label: 'conversation list test id' },
  {
    selector: '[class~="conversationConversationListwrapper"]',
    label: 'conversation list semantic class',
  },
];

export const MESSAGE_REGION_SELECTORS: readonly AuthCssSignal[] = [
  { selector: '[data-testid="message-region"]', label: 'message region test id' },
  {
    selector: '[class~="componentsRightPanelwrapper"]',
    label: 'chat right-panel semantic class',
  },
];

export const CONVERSATION_ITEM_SELECTOR = '[data-e2e="conversation-item"]';

export const CONVERSATION_TITLE_SELECTORS = [
  '[data-testid="conversation-title"]',
  '[class~="conversationConversationItemtitle"]',
] as const;
