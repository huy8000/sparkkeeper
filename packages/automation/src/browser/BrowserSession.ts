import { mkdir } from 'node:fs/promises';

import { chromium, type BrowserContext, type Page } from 'playwright';

import type { BrowserSessionConfig } from './config.js';

type BrowserSessionState = 'idle' | 'starting' | 'running' | 'closing';

export interface BrowserSessionHandle {
  readonly context: BrowserContext;
  readonly page: Page;
}

export class BrowserSessionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserSessionError';
  }
}

export class BrowserSession {
  private state: BrowserSessionState = 'idle';
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private startOperation: Promise<BrowserSessionHandle> | undefined;
  private closeOperation: Promise<void> | undefined;

  public constructor(private readonly config: BrowserSessionConfig) {}

  public isRunning(): boolean {
    return this.state === 'running' && this.context !== undefined;
  }

  public start(): Promise<BrowserSessionHandle> {
    if (this.state === 'running') {
      return this.reuseRunningSession();
    }

    if (this.startOperation !== undefined) {
      return this.startOperation;
    }

    if (this.closeOperation !== undefined) {
      return this.closeOperation.then(() => this.start());
    }

    const operation = this.startInternal().finally(() => {
      if (this.startOperation === operation) {
        this.startOperation = undefined;
      }
    });
    this.startOperation = operation;

    return operation;
  }

  public close(): Promise<void> {
    if (this.closeOperation !== undefined) {
      return this.closeOperation;
    }

    const operation = this.closeInternal().finally(() => {
      if (this.closeOperation === operation) {
        this.closeOperation = undefined;
      }
    });
    this.closeOperation = operation;

    return operation;
  }

  public getContext(): BrowserContext {
    if (!this.isRunning() || this.context === undefined) {
      throw new BrowserSessionError('Browser session is not running; call start() first.');
    }

    return this.context;
  }

  public getPage(): Page {
    if (!this.isRunning() || this.page === undefined || this.page.isClosed()) {
      throw new BrowserSessionError(
        'Browser session has no active page; call start() to create or recover one.',
      );
    }

    return this.page;
  }

  protected launchContext(): Promise<BrowserContext> {
    return chromium.launchPersistentContext(this.config.userDataDir, {
      headless: this.config.headless,
      locale: this.config.locale,
      timezoneId: this.config.timezoneId,
      viewport: this.config.viewport,
    });
  }

  private async startInternal(): Promise<BrowserSessionHandle> {
    this.state = 'starting';

    try {
      await mkdir(this.config.userDataDir, { recursive: true });
      const context = await this.launchContext();
      this.attachContext(context);
      const page = await this.findOrCreatePage(context);

      if (this.context !== context) {
        throw new BrowserSessionError(
          'Persistent Chromium context closed before startup completed.',
        );
      }

      this.attachPage(page);
      this.state = 'running';

      return { context, page };
    } catch (cause) {
      await this.disposeFailedStart();

      if (cause instanceof BrowserSessionError) {
        throw cause;
      }

      throw new BrowserSessionError(
        `Failed to start persistent Chromium with profile "${this.config.userDataDir}".`,
        { cause },
      );
    }
  }

  private async reuseRunningSession(): Promise<BrowserSessionHandle> {
    const context = this.getContext();
    let page = this.page;

    if (page === undefined || page.isClosed()) {
      try {
        page = await this.findOrCreatePage(context);
      } catch (cause) {
        throw new BrowserSessionError(
          'Failed to create a replacement page in the running browser session.',
          { cause },
        );
      }

      if (this.context !== context) {
        throw new BrowserSessionError(
          'Persistent Chromium context closed while creating a replacement page.',
        );
      }

      this.attachPage(page);
    }

    return { context, page };
  }

  private async closeInternal(): Promise<void> {
    if (this.startOperation !== undefined) {
      try {
        await this.startOperation;
      } catch {
        return;
      }
    }

    const context = this.context;
    if (context === undefined) {
      this.clearRuntimeState();
      return;
    }

    this.state = 'closing';

    try {
      await context.close();
    } catch (cause) {
      if (this.context === context) {
        throw new BrowserSessionError(
          `Failed to close persistent Chromium using profile "${this.config.userDataDir}".`,
          { cause },
        );
      }
    } finally {
      if (this.context === context) {
        this.clearRuntimeState();
      }
    }
  }

  private attachContext(context: BrowserContext): void {
    this.context = context;
    context.once('close', () => {
      if (this.context === context) {
        this.clearRuntimeState();
      }
    });
  }

  private attachPage(page: Page): void {
    this.page = page;
    page.once('close', () => {
      if (this.page === page) {
        this.page = undefined;
      }
    });
  }

  private async findOrCreatePage(context: BrowserContext): Promise<Page> {
    const existingPage = context.pages().find((candidate) => !candidate.isClosed());
    return existingPage ?? context.newPage();
  }

  private async disposeFailedStart(): Promise<void> {
    const context = this.context;
    this.clearRuntimeState();

    if (context !== undefined) {
      try {
        await context.close();
      } catch {
        // Preserve the startup failure, which contains the actionable context.
      }
    }
  }

  private clearRuntimeState(): void {
    this.context = undefined;
    this.page = undefined;
    this.state = 'idle';
  }
}
