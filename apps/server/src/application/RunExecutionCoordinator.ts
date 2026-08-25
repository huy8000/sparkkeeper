import type { BusinessDate } from '@sparkkeeper/shared';

export interface RunExecutionLease {
  release(): void;
}

export class RunExecutionCoordinator {
  private readonly activeKeys = new Set<string>();

  tryAcquire(accountId: string, businessDate: BusinessDate): RunExecutionLease | undefined {
    const key = executionKey(accountId, businessDate);
    // Production runs share one persistent Browser profile. Serializing all executions also
    // enforces the narrower Account/BusinessDate exclusion required for idempotency.
    if (this.activeKeys.size > 0) return undefined;
    this.activeKeys.add(key);
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        this.activeKeys.delete(key);
      },
    };
  }

  isActive(accountId: string, businessDate: BusinessDate): boolean {
    return this.activeKeys.has(executionKey(accountId, businessDate));
  }

  get isBusy(): boolean {
    return this.activeKeys.size > 0;
  }

  get activeCount(): number {
    return this.activeKeys.size;
  }
}

function executionKey(accountId: string, businessDate: BusinessDate): string {
  return `${accountId}:${businessDate}`;
}
