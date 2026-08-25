import { createDatabase, executeMaintenanceCommand } from '../src/index.js';

const client = createDatabase();
try {
  client.migrate();
  const output = executeMaintenanceCommand(client, process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Maintenance command failed.';
  process.stderr.write(`Maintenance command failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  client.close();
}
