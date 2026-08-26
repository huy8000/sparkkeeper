import http from 'node:http';
import process from 'node:process';

const request = http.get(
  { host: '127.0.0.1', port: 6080, path: '/', timeout: 3_000 },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on('timeout', () => request.destroy(new Error('Maintenance healthcheck timeout.')));
request.on('error', () => {
  process.exitCode = 1;
});
