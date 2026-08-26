# syntax=docker/dockerfile:1.7

ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble

FROM ${PLAYWRIGHT_IMAGE} AS build
USER root
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN CI=true pnpm --config.inject-workspace-packages=true --filter @sparkkeeper/server deploy --prod /opt/sparkkeeper/server
RUN rm -rf /opt/sparkkeeper/server/src /opt/sparkkeeper/server/test /opt/sparkkeeper/server/scripts \
    && rm -f /opt/sparkkeeper/server/tsconfig.json /opt/sparkkeeper/server/pnpm-lock.yaml \
    && for package_dir in /opt/sparkkeeper/server/node_modules/.pnpm/@sparkkeeper+*/node_modules/@sparkkeeper/*; do \
      if [ -d "${package_dir}" ]; then \
        rm -rf "${package_dir}/src" "${package_dir}/test" "${package_dir}/scripts"; \
        rm -f "${package_dir}/tsconfig.json"; \
      fi; \
    done

FROM ${PLAYWRIGHT_IMAGE} AS app-runtime
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=build --chown=pwuser:pwuser /opt/sparkkeeper/server /app/server
COPY --chown=pwuser:pwuser docker/app-entrypoint.sh /usr/local/bin/sparkkeeper-app
COPY --chown=pwuser:pwuser docker/docker-healthcheck.mjs /app/server/docker-healthcheck.mjs
RUN chmod 0555 /usr/local/bin/sparkkeeper-app
USER pwuser
ENTRYPOINT ["/usr/local/bin/sparkkeeper-app"]

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS admin-runtime
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html

FROM app-runtime AS maintenance-runtime
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends novnc openbox websockify x11vnc xvfb \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=pwuser:pwuser docker/maintenance-entrypoint.sh /usr/local/bin/sparkkeeper-maintenance
COPY --chown=pwuser:pwuser docker/maintenance-browser.mjs /app/server/maintenance-browser.mjs
COPY --chown=pwuser:pwuser docker/maintenance-healthcheck.mjs /app/server/maintenance-healthcheck.mjs
RUN chmod 0555 /usr/local/bin/sparkkeeper-maintenance
USER pwuser
ENTRYPOINT ["/usr/local/bin/sparkkeeper-maintenance"]
