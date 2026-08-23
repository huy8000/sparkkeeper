import { SchedulerService } from './lifecycle/SchedulerService.js';

const service = new SchedulerService();
const state = await service.start();
console.info(`SparkKeeper server scheduler: ${state}.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void service.stop().then(() => process.exit(0));
  });
}
