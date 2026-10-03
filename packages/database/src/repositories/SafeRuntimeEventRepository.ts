import { asc, desc, gt } from 'drizzle-orm';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import { v4SystemEvents } from '../schema/index.js';
export class SafeRuntimeEventRepository {
  constructor(readonly client: DatabaseClient) {}
  highWater() {
    return (
      this.client.orm
        .select({ n: v4SystemEvents.sequence })
        .from(v4SystemEvents)
        .orderBy(desc(v4SystemEvents.sequence))
        .get()?.n ?? 0
    );
  }
  after(sequence: number) {
    return this.client.orm
      .select()
      .from(v4SystemEvents)
      .where(gt(v4SystemEvents.sequence, sequence))
      .orderBy(asc(v4SystemEvents.sequence))
      .limit(100)
      .all();
  }
}
