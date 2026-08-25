import type { ApiReadService } from './ApiReadService.js';
import type { ApiConfigurationService } from './ApiConfigurationService.js';
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
  readonly configuration: Pick<
    ApiConfigurationService,
    | 'createAccount'
    | 'updateAccount'
    | 'createFriend'
    | 'updateFriend'
    | 'listTemplates'
    | 'getTemplate'
    | 'createTemplate'
    | 'updateTemplate'
    | 'configureSchedule'
  >;
}
