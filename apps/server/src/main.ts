import { SchedulerService } from './lifecycle/SchedulerService.js';

const service = new SchedulerService();
await service.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void service.stop().then(() => process.exit(0));
  });
}
