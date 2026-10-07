#!/usr/bin/env bash
# Installs or updates FingridFlow Live on a host with rootless podman.
# Run it on the server as the user that owns the containers (e.g. opc):
#
#   curl -fsSL https://raw.githubusercontent.com/Saavuori/fingrid-data-collector/main/deploy/viewer/install.sh | bash
#
# It asks for the Fingrid API key once and keeps it in a podman secret.
set -euo pipefail

REPO="Saavuori/fingrid-data-collector"
BRANCH="${BRANCH:-main}"
UNIT_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/deploy/viewer/fingrid-viewer.container"
UNIT_DIR="${HOME}/.config/containers/systemd"

command -v podman >/dev/null || { echo "podman is not installed" >&2; exit 1; }

echo "==> podman $(podman --version | awk '{print $3}')"

if podman secret inspect fingrid_api_key >/dev/null 2>&1; then
  echo "==> Fingrid API key secret already exists (podman secret rm fingrid_api_key to replace it)"
else
  # Read from the terminal even when the script itself arrives on stdin.
  read -rsp "Fingrid API key (from data.fingrid.fi): " key </dev/tty
  echo
  [ -n "$key" ] || { echo "No key given" >&2; exit 1; }
  printf '%s' "$key" | podman secret create fingrid_api_key - >/dev/null
  echo "==> Stored the key as podman secret 'fingrid_api_key'"
fi

mkdir -p "$UNIT_DIR"
curl -fsSL "$UNIT_URL" -o "${UNIT_DIR}/fingrid-viewer.container"
echo "==> Installed ${UNIT_DIR}/fingrid-viewer.container"

systemctl --user daemon-reload
systemctl --user restart fingrid-viewer.service
# Picks up new images published by CI.
systemctl --user enable --now podman-auto-update.timer >/dev/null 2>&1 || true

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "!!  Lingering is off, so the service stops when you log out. Enable it with:"
  echo "      sudo loginctl enable-linger $USER"
fi

echo "==> Waiting for the dashboard to come up..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3010/api/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:3010/api/health; echo
    echo "==> Running on 127.0.0.1:3010. Point Caddy at it (see deploy/viewer/Caddyfile.example)."
    exit 0
  fi
  sleep 2
done
echo "!!  Not answering yet. Check: journalctl --user -u fingrid-viewer -n 50 --no-pager" >&2
exit 1
