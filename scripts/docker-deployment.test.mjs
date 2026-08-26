import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const files = Object.fromEntries(
  await Promise.all(
    [
      'docker-compose.yml',
      'Dockerfile',
      '.dockerignore',
      'docker/nginx.conf',
      'docker/docker-healthcheck.mjs',
      'docker/app-entrypoint.sh',
      'docker/maintenance-entrypoint.sh',
      'docker/maintenance-browser.mjs',
      'scripts/docker-maintenance.sh',
      'scripts/docker-production-smoke.mjs',
      'scripts/docker-maintenance-smoke.mjs',
    ].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')]),
  ),
);

test('Compose exposes only loopback Admin and opt-in noVNC ports', () => {
  const compose = files['docker-compose.yml'];
  assert.match(compose, /127\.0\.0\.1:8080:8080/u);
  assert.match(compose, /127\.0\.0\.1:6080:6080/u);
  assert.doesNotMatch(compose, /(?:^|\s)-?\s*["']?5900:/mu);
  assert.doesNotMatch(
    compose,
    /privileged:\s*true|network_mode:\s*host|pid:\s*host|docker\.sock/iu,
  );
  assert.match(compose, /profiles:\s*\n\s*- maintenance/u);
  assert.match(compose, /create_host_path:\s*false/u);
});

test('Compose persists one data root and keeps every real-side-effect gate disabled', () => {
  const compose = files['docker-compose.yml'];
  assert.match(compose, /source:\s*\$\{SPARKKEEPER_DATA_DIR:-\.\/data\}/u);
  assert.match(compose, /target:\s*\/app\/data/u);
  assert.match(compose, /DATA_DIR:\s*\/app\/data/u);
  assert.match(compose, /BROWSER_PROFILE_DIR:\s*\/app\/data\/browser-profile/u);
  assert.match(compose, /LOG_DIR:\s*\/app\/data\/logs/u);
  for (const gate of ['SCHEDULER_ENABLED', 'SCHEDULER_ALLOW_REAL_SEND', 'MANUAL_RUN_ENABLED']) {
    assert.ok(compose.includes(`${gate}: ` + '${' + `${gate}:-false}`));
  }
  assert.match(compose, /stop_grace_period:\s*10m/u);
});

test('Dockerfile is multi-stage, version-aligned, frozen, and non-root at runtime', () => {
  const dockerfile = files.Dockerfile;
  assert.match(dockerfile, /mcr\.microsoft\.com\/playwright:v1\.62\.1-noble/u);
  assert.match(dockerfile, /build-essential python3/u);
  assert.match(dockerfile, /corepack prepare pnpm@11\.19\.0/u);
  assert.match(dockerfile, /RUN CI=true pnpm --config\.inject-workspace-packages=true/u);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/u);
  assert.match(dockerfile, /--config\.inject-workspace-packages=true/u);
  assert.match(dockerfile, /--filter @sparkkeeper\/server deploy --prod/u);
  assert.doesNotMatch(dockerfile, /deploy --prod --legacy/u);
  assert.match(dockerfile, /rm -rf .*\/src.*\/test.*\/scripts/u);
  assert.match(dockerfile, /AS admin-runtime/u);
  assert.match(dockerfile, /AS maintenance-runtime/u);
  assert.match(dockerfile, /USER pwuser/u);
  const runtimeStages = dockerfile.slice(
    dockerfile.indexOf(`FROM ${'${PLAYWRIGHT_IMAGE}'} AS app-runtime`),
  );
  assert.doesNotMatch(runtimeStages, /build-essential/u);
});

test('Nginx serves SPA history and proxies API/SSE without buffering or CORS changes', () => {
  const nginx = files['docker/nginx.conf'];
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/u);
  assert.match(nginx, /location \/api\//u);
  assert.match(nginx, /proxy_pass http:\/\/app:8080/u);
  assert.match(nginx, /proxy_buffering off/u);
  assert.match(nginx, /proxy_cache off/u);
  assert.doesNotMatch(nginx, /Access-Control-Allow-Origin/iu);
});

test('application healthcheck requires database and migration readiness', () => {
  const healthcheck = files['docker/docker-healthcheck.mjs'];
  assert.match(healthcheck, /data\?\.status === 'READY'/u);
  assert.match(healthcheck, /database\?\.status === 'READY'/u);
  assert.match(healthcheck, /migration\?\.status === 'READY'/u);
});

test('normal and maintenance runtimes share an exclusive profile lock', () => {
  const app = files['docker/app-entrypoint.sh'];
  const maintenance = files['docker/maintenance-entrypoint.sh'];
  assert.match(app, /profile_lock="\$\{profile_dir\}\.lock"/u);
  assert.match(app, /flock.*\$\{profile_lock\}/u);
  assert.match(maintenance, /profile_lock="\$\{profile_dir\}\.lock"/u);
  assert.match(maintenance, /exec 9>"\$\{profile_lock\}"/u);
  assert.match(maintenance, /flock.*9/u);
  assert.doesNotMatch(maintenance, /dist\/main\.js|SchedulerService|Fastify/u);
  assert.match(files['docker/maintenance-browser.mjs'], /about:blank/u);
  assert.doesNotMatch(
    `${maintenance}\n${files['docker/maintenance-browser.mjs']}`,
    /douyin|send:smoke|auth:smoke|contact:smoke/iu,
  );
});

test('maintenance wrapper stops normal runtime before start and releases it before restart', () => {
  const wrapper = files['scripts/docker-maintenance.sh'];
  assert.match(wrapper, /docker compose stop app/u);
  assert.match(wrapper, /--profile maintenance up -d maintenance/u);
  assert.match(wrapper, /wait_healthy maintenance/u);
  assert.match(wrapper, /--profile maintenance stop maintenance/u);
  assert.match(wrapper, /restart_normal/u);
  assert.match(wrapper, /wait_healthy app/u);
  assert.match(wrapper, /wait_healthy admin/u);
});

test('Docker build context excludes private and runtime artifacts', () => {
  const ignore = files['.dockerignore'];
  for (const pattern of [
    '.git',
    'node_modules',
    'dist',
    'data',
    'browser-profile',
    'logs',
    'screenshots',
    'traces',
    '.env*',
    'task_plan.md',
    'findings.md',
    'progress.md',
  ]) {
    assert.match(ignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'mu'));
  }
  assert.match(ignore, /!\.env\.example/u);
});

test('Docker smoke gates use temporary fixtures and keep every side-effect gate off', () => {
  const production = files['scripts/docker-production-smoke.mjs'];
  const maintenance = files['scripts/docker-maintenance-smoke.mjs'];
  for (const smoke of [production, maintenance]) {
    assert.match(smoke, /mkdtempSync/u);
    assert.match(smoke, /SCHEDULER_ENABLED: 'false'/u);
    assert.match(smoke, /SCHEDULER_ALLOW_REAL_SEND: 'false'/u);
    assert.match(smoke, /MANUAL_RUN_ENABLED: 'false'/u);
    assert.doesNotMatch(smoke, /douyin|auth:smoke|contact:smoke|send:smoke/iu);
  }
  assert.match(production, /event: ready/u);
  assert.match(production, /fresh database must apply migrations 0000 through 0007/u);
  assert.match(maintenance, /expectedStatus: 73/u);
  assert.match(maintenance, /headed Chromium/u);
});
