import { createHmac, randomBytes } from 'node:crypto';

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_MAX_ENTRIES = 10_000;

export const ARGON2_GATE_MAX_ACTIVE = 2;
export const ARGON2_GATE_MAX_QUEUED = 8;
export const ARGON2_GATE_QUEUE_TIMEOUT_MS = 2000; // 2 seconds

export interface RateLimitReservationResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
  readonly reason?: 'IP_RATE_LIMITED' | 'USERNAME_RATE_LIMITED' | 'CAPACITY_EXCEEDED';
}

interface WindowBucket {
  count: number;
  windowStart: number;
}

export class Argon2WorkGateError extends Error {
  readonly retryAfterSeconds: number;
  readonly code = 'RATE_LIMITED';

  constructor(message: string, retryAfterSeconds = 1) {
    super(message);
    this.name = 'Argon2WorkGateError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class Argon2WorkGate {
  private activeCount = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  readonly maxActive: number;
  readonly maxQueued: number;
  readonly queueTimeoutMs: number;

  constructor(
    maxActive = ARGON2_GATE_MAX_ACTIVE,
    maxQueued = ARGON2_GATE_MAX_QUEUED,
    queueTimeoutMs = ARGON2_GATE_QUEUE_TIMEOUT_MS,
  ) {
    this.maxActive = maxActive;
    this.maxQueued = maxQueued;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  get currentActive(): number {
    return this.activeCount;
  }

  get currentQueued(): number {
    return this.queue.length;
  }

  /**
   * Acquires a slot in the work gate.
   * Throws Argon2WorkGateError with retryAfterSeconds=1 on queue saturation or wait timeout.
   */
  async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxActive) {
      this.activeCount++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    if (this.queue.length >= this.maxQueued) {
      throw new Argon2WorkGateError('Argon2 work gate capacity saturated.', 1);
    }

    return new Promise<() => void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((entry) => entry.timer === timer);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        rejectPromise(new Argon2WorkGateError('Argon2 work gate queue wait timed out.', 1));
      }, this.queueTimeoutMs);

      this.queue.push({
        resolve: () => {
          clearTimeout(timer);
          this.activeCount++;
          let released = false;
          resolvePromise(() => {
            if (!released) {
              released = true;
              this.release();
            }
          });
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
        timer,
      });
    });
  }

  /**
   * Executes an async operation within the work gate, guaranteeing slot release.
   */
  async withGate<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.queue.length > 0 && this.activeCount < this.maxActive) {
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    }
  }
}

export class LoginRateLimiter {
  private readonly hmacKey: Buffer;
  private readonly buckets = new Map<string, WindowBucket>();
  readonly gate: Argon2WorkGate;
  readonly windowMs: number;
  readonly maxAttempts: number;
  readonly maxEntries: number;

  constructor(options?: {
    hmacKey?: Buffer;
    gate?: Argon2WorkGate;
    windowMs?: number;
    maxAttempts?: number;
    maxEntries?: number;
  }) {
    this.hmacKey = options?.hmacKey ?? randomBytes(32);
    this.gate = options?.gate ?? new Argon2WorkGate();
    this.windowMs = options?.windowMs ?? RATE_LIMIT_WINDOW_MS;
    this.maxAttempts = options?.maxAttempts ?? RATE_LIMIT_MAX_ATTEMPTS;
    this.maxEntries = options?.maxEntries ?? RATE_LIMIT_MAX_ENTRIES;
  }

  get totalEntries(): number {
    return this.buckets.size;
  }

  private hashKey(dimension: 'ip' | 'username', value: string): string {
    return createHmac('sha256', this.hmacKey)
      .update(`${dimension}\0${value}`, 'utf8')
      .digest('hex');
  }

  /**
   * Prunes expired window buckets.
   */
  prune(nowMs: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (nowMs - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Atomically checks and reserves an attempt for both IP and normalized username.
   * If either dimension is rate limited, returns allowed: false with deterministic retryAfterSeconds.
   */
  checkAndReserve(
    ip: string,
    normalizedUsername: string,
    now: Date = new Date(),
  ): RateLimitReservationResult {
    const nowMs = now.getTime();
    this.prune(nowMs);

    const ipKey = this.hashKey('ip', ip);
    const usernameKey = this.hashKey('username', normalizedUsername);

    const ipBucket = this.buckets.get(ipKey);
    const usernameBucket = this.buckets.get(usernameKey);

    // Check IP bucket
    if (ipBucket && nowMs - ipBucket.windowStart < this.windowMs) {
      if (ipBucket.count >= this.maxAttempts) {
        const remainingMs = ipBucket.windowStart + this.windowMs - nowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return {
          allowed: false,
          retryAfterSeconds,
          reason: 'IP_RATE_LIMITED',
        };
      }
    }

    // Check Username bucket
    if (usernameBucket && nowMs - usernameBucket.windowStart < this.windowMs) {
      if (usernameBucket.count >= this.maxAttempts) {
        const remainingMs = usernameBucket.windowStart + this.windowMs - nowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return {
          allowed: false,
          retryAfterSeconds,
          reason: 'USERNAME_RATE_LIMITED',
        };
      }
    }

    // Check capacity before creating new entries
    const neededNewEntries = (ipBucket ? 0 : 1) + (usernameBucket ? 0 : 1);
    if (this.buckets.size + neededNewEntries > this.maxEntries) {
      return {
        allowed: false,
        retryAfterSeconds: 60,
        reason: 'CAPACITY_EXCEEDED',
      };
    }

    // Reserve attempt on IP bucket
    if (!ipBucket || nowMs - ipBucket.windowStart >= this.windowMs) {
      this.buckets.set(ipKey, { count: 1, windowStart: nowMs });
    } else {
      ipBucket.count++;
    }

    // Reserve attempt on Username bucket
    if (!usernameBucket || nowMs - usernameBucket.windowStart >= this.windowMs) {
      this.buckets.set(usernameKey, { count: 1, windowStart: nowMs });
    } else {
      usernameBucket.count++;
    }

    return { allowed: true };
  }

  /**
   * Clears the IP and Username windows upon successful login.
   */
  recordSuccess(ip: string, normalizedUsername: string): void {
    const ipKey = this.hashKey('ip', ip);
    const usernameKey = this.hashKey('username', normalizedUsername);
    this.buckets.delete(ipKey);
    this.buckets.delete(usernameKey);
  }

  /**
   * Runs an operation through the Argon2 work gate.
   */
  async withGate<T>(fn: () => Promise<T>): Promise<T> {
    return this.gate.withGate(fn);
  }
}
