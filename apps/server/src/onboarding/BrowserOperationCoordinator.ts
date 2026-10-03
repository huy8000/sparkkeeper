import { randomUUID } from 'node:crypto';

export interface BrowserOperationLease {
  readonly operationId: string;
  readonly profileKey: string;
  readonly token: string;
  release(): void;
}

export class BrowserOperationCoordinator {
  private active:
    | { readonly operationId: string; readonly profileKey: string; readonly token: string }
    | undefined;

  acquire(operationId: string, profileKey: string): BrowserOperationLease | undefined {
    const normalizedOperationId = operationId.trim();
    const normalizedProfileKey = profileKey.trim();
    if (normalizedOperationId.length === 0 || normalizedProfileKey.length === 0) {
      throw new Error('Browser operation lease requires operationId and profileKey.');
    }
    if (this.active !== undefined) return undefined;

    const token = randomUUID();
    this.active = {
      operationId: normalizedOperationId,
      profileKey: normalizedProfileKey,
      token,
    };
    let released = false;
    return {
      operationId: normalizedOperationId,
      profileKey: normalizedProfileKey,
      token,
      release: () => {
        if (released) return;
        released = true;
        if (this.active?.token === token) this.active = undefined;
      },
    };
  }

  isHeldBy(operationId: string): boolean {
    return this.active?.operationId === operationId;
  }

  /** Read-only capability check; operation IDs alone are not lease ownership. */
  isLeaseCurrent(lease: BrowserOperationLease): boolean {
    return (
      this.active !== undefined &&
      this.active.token === lease.token &&
      this.active.operationId === lease.operationId &&
      this.active.profileKey === lease.profileKey
    );
  }

  current(): { readonly operationId: string; readonly profileKey: string } | undefined {
    if (!this.active) return undefined;
    return { operationId: this.active.operationId, profileKey: this.active.profileKey };
  }
}
