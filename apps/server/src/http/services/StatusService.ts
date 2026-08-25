export const SERVICE_NAME = 'SparkKeeper';

export interface DatabaseProbe {
  ping(): true;
}

export interface StatusServiceOptions {
  readonly database: DatabaseProbe;
  readonly migrationReady: boolean | (() => boolean);
  readonly schedulerEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly timezone: string;
  readonly observabilityReady: boolean;
  readonly browserProfileConfigured: boolean;
  readonly version: string;
  readonly clock?: () => Date;
}

export interface HealthStatus {
  readonly serviceName: typeof SERVICE_NAME;
  readonly version: string;
  readonly status: 'READY' | 'DEGRADED';
  readonly database: { readonly status: 'READY' | 'UNAVAILABLE' };
  readonly migration: { readonly status: 'READY' | 'NOT_READY' };
  readonly timestamp: string;
}

export interface RuntimeStatus {
  readonly serverStatus: 'READY' | 'DEGRADED';
  readonly schedulerEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly timezone: string;
  readonly databaseReady: boolean;
  readonly migrationReady: boolean;
  readonly observabilityReady: boolean;
  readonly browserProfileConfigured: boolean;
  readonly version: string;
  readonly timestamp: string;
}

export class StatusService {
  private readonly clock: () => Date;

  constructor(private readonly options: StatusServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  health(): HealthStatus {
    const databaseReady = this.databaseReady();
    const migrationReady = this.migrationReady();
    const ready = databaseReady && migrationReady;
    return {
      serviceName: SERVICE_NAME,
      version: this.options.version,
      status: ready ? 'READY' : 'DEGRADED',
      database: { status: databaseReady ? 'READY' : 'UNAVAILABLE' },
      migration: { status: migrationReady ? 'READY' : 'NOT_READY' },
      timestamp: this.clock().toISOString(),
    };
  }

  runtime(): RuntimeStatus {
    const databaseReady = this.databaseReady();
    const migrationReady = this.migrationReady();
    return {
      serverStatus: databaseReady && migrationReady ? 'READY' : 'DEGRADED',
      schedulerEnabled: this.options.schedulerEnabled,
      realSendAuthorizationEnabled: this.options.realSendAuthorizationEnabled,
      timezone: this.options.timezone,
      databaseReady,
      migrationReady,
      observabilityReady: this.options.observabilityReady,
      browserProfileConfigured: this.options.browserProfileConfigured,
      version: this.options.version,
      timestamp: this.clock().toISOString(),
    };
  }

  private databaseReady(): boolean {
    try {
      return this.options.database.ping();
    } catch {
      return false;
    }
  }

  private migrationReady(): boolean {
    try {
      return typeof this.options.migrationReady === 'function'
        ? this.options.migrationReady()
        : this.options.migrationReady;
    } catch {
      return false;
    }
  }
}
