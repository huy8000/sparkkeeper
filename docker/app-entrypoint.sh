#!/usr/bin/env bash
set -euo pipefail

data_dir="${DATA_DIR:-/app/data}"
profile_dir="${BROWSER_PROFILE_DIR:-${data_dir}/browser-profile}"
log_dir="${LOG_DIR:-${data_dir}/logs}"
profile_lock="${profile_dir}.lock"

mkdir -p "${data_dir}" "${profile_dir}" "${log_dir}" "${data_dir}/screenshots" "${data_dir}/traces"

exec flock --exclusive --nonblock --no-fork "${profile_lock}" node /app/server/dist/main.js
