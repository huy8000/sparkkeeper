#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

action="${1:-}"
password_file="${NOVNC_PASSWORD_FILE:-./.secrets/novnc-password}"

require_docker() {
  docker compose version >/dev/null
  docker info >/dev/null
}

is_running() {
  local service="$1"
  [[ -n "$(docker compose --profile maintenance ps --status running --services "${service}")" ]]
}

wait_stopped() {
  local service="$1"
  for _ in $(seq 1 60); do
    if ! is_running "${service}"; then return 0; fi
    sleep 1
  done
  echo "${service} did not stop safely." >&2
  return 1
}

wait_healthy() {
  local service="$1"
  local container_id
  local health
  for _ in $(seq 1 120); do
    container_id="$(docker compose --profile maintenance ps -a -q "${service}")"
    if [[ -n "${container_id}" ]]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
      if [[ "${health}" == "healthy" ]]; then return 0; fi
      if [[ "${health}" == "unhealthy" || "${health}" == "exited" || "${health}" == "dead" ]]; then
        echo "${service} became ${health}." >&2
        return 1
      fi
    fi
    sleep 1
  done
  echo "${service} did not become healthy." >&2
  return 1
}

restart_normal() {
  docker compose up -d app admin
  wait_healthy app
  wait_healthy admin
}

case "${action}" in
  start)
    require_docker
    if [[ ! -f "${password_file}" || ! -s "${password_file}" ]]; then
      echo 'Create a non-empty noVNC password file and set NOVNC_PASSWORD_FILE.' >&2
      exit 64
    fi
    if is_running maintenance; then
      echo 'Maintenance is already running.'
      exit 0
    fi
    docker compose stop app
    wait_stopped app
    if ! NOVNC_PASSWORD_FILE="${password_file}" docker compose --profile maintenance up -d maintenance; then
      restart_normal
      exit 1
    fi
    if ! wait_healthy maintenance; then
      NOVNC_PASSWORD_FILE="${password_file}" docker compose --profile maintenance stop maintenance
      wait_stopped maintenance
      restart_normal
      exit 1
    fi
    ;;
  stop)
    require_docker
    NOVNC_PASSWORD_FILE="${password_file}" docker compose --profile maintenance stop maintenance
    wait_stopped maintenance
    restart_normal
    ;;
  status)
    require_docker
    docker compose --profile maintenance ps
    ;;
  *)
    echo 'Usage: scripts/docker-maintenance.sh {start|stop|status}' >&2
    exit 64
    ;;
esac
