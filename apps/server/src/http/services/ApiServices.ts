import type { ApiReadService } from './ApiReadService.js';
import type { StatusService } from './StatusService.js';

export interface ApiServices {
  readonly status: Pick<StatusService, 'health' | 'runtime'>;
  readonly read: Pick<
    ApiReadService,
    | 'listAccounts'
    | 'getAccount'
    | 'listFriends'
    | 'getFriend'
    | 'listSchedules'
    | 'getSchedule'
    | 'listRuns'
    | 'getRun'
    | 'listSendRecords'
    | 'listSystemEvents'
  >;
}
