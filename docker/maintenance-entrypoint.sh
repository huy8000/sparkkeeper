#!/usr/bin/env bash
set -euo pipefail

data_dir="${DATA_DIR:-/app/data}"
profile_dir="${BROWSER_PROFILE_DIR:-${data_dir}/browser-profile}"
profile_lock="${profile_dir}.lock"
password_file="${NOVNC_PASSWORD_FILE:-/run/secrets/novnc-password}"
display="${DISPLAY:-:99}"
screen="${NOVNC_SCREEN:-1440x900x24}"

if [[ ! -f "${password_file}" || ! -s "${password_file}" ]]; then
  echo 'noVNC password file is required.' >&2
  exit 64
fi

mkdir -p "${data_dir}" "${profile_dir}" /tmp/sparkkeeper-vnc
exec 9>"${profile_lock}"
if ! flock --exclusive --nonblock 9; then
  echo 'Browser profile is already reserved by the normal runtime.' >&2
  exit 73
fi

password="$(<"${password_file}")"
x11vnc -storepasswd "${password}" /tmp/sparkkeeper-vnc/passwd >/dev/null
unset password

pids=()
cleanup() {
  trap - SIGINT SIGTERM EXIT
  for pid in "${pids[@]:-}"; do
    kill "${pid}" 2>/dev/null || true
  done
  for pid in "${pids[@]:-}"; do
    wait "${pid}" 2>/dev/null || true
  done
}
trap cleanup SIGINT SIGTERM EXIT

Xvfb "${display}" -screen 0 "${screen}" -nolisten tcp >/tmp/sparkkeeper-vnc/xvfb.log 2>&1 &
pids+=("$!")

for _ in $(seq 1 50); do
  [[ -S "/tmp/.X11-unix/X${display#:}" ]] && break
  sleep 0.1
done
if [[ ! -S "/tmp/.X11-unix/X${display#:}" ]]; then
  echo 'Xvfb did not become ready.' >&2
  exit 70
fi

openbox-session >/tmp/sparkkeeper-vnc/openbox.log 2>&1 &
pids+=("$!")
x11vnc -display "${display}" -localhost -forever -shared -rfbport 5900 \
  -rfbauth /tmp/sparkkeeper-vnc/passwd >/tmp/sparkkeeper-vnc/x11vnc.log 2>&1 &
pids+=("$!")
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 \
  >/tmp/sparkkeeper-vnc/websockify.log 2>&1 &
pids+=("$!")
node /app/server/maintenance-browser.mjs >/tmp/sparkkeeper-vnc/browser.log 2>&1 &
pids+=("$!")

wait -n "${pids[@]}"
