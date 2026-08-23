/** Login-state metadata shared by automation and persistence boundaries. */
export type LoginStatus = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';

/** Identity metadata that can be shared without database or browser dependencies. */
export interface FriendIdentity {
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
}

/** The single normalized identity field currently used to bind a Friend. */
export type FriendMatchField = 'displayName' | 'remarkName' | 'shortId' | 'uniqueId' | 'secUid';

/** Message provider kinds supported by the V1 template engine. */
export type MessageProviderType = 'STATIC' | 'RANDOM';

/** Persisted message template domain object shared by persistence and generation boundaries. */
export interface MessageTemplate {
  readonly id: string;
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messages: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export {
  BusinessDateError,
  DEFAULT_APP_TIMEZONE,
  parseBusinessDate,
  resolveBusinessDate,
  resolveBusinessTimeZone,
  type BusinessDate,
  type BusinessDateErrorCode,
} from './BusinessDate.js';

export type DailyRunStatus = 'READY' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED';

export type SendRecordStatus = 'READY' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN';

export {
  parseScheduleTime,
  ScheduleTimeError,
  scheduleTimeToMinutes,
  validateScheduleWindow,
  type ScheduleTime,
} from './ScheduleTime.js';
