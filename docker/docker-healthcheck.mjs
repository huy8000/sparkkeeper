import http from 'node:http';
import process from 'node:process';

const request = http.get(
  { host: '127.0.0.1', port: 8080, path: '/api/health', timeout: 3_000 },
  (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      if (body.length < 16_384) body += chunk;
    });
    response.on('end', () => {
      try {
        const payload = JSON.parse(body);
        process.exitCode =
          response.statusCode === 200 &&
          payload?.success === true &&
          // Public health deliberately exposes no DB/migration details. READY
          // is the service's conjunction of both probes, not an auth bypass.
          payload?.data?.serviceName === 'SparkKeeper' &&
          payload?.data?.status === 'READY'
            ? 0
            : 1;
      } catch {
        process.exitCode = 1;
      }
    });
  },
);
request.on('timeout', () => request.destroy(new Error('Healthcheck timeout.')));
request.on('error', () => {
  process.exitCode = 1;
});
