#!/bin/bash
set -e

REPO="Saavuori/fingrid-data-collector"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
INSTALL_DIR="${1:-fingrid-collector}"

echo "==> Installing Fingrid Open Data Collector into ./${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "==> Downloading docker-compose.yml..."
curl -fsSL "${BASE_URL}/docker-compose.yml" -o docker-compose.yml

if [ ! -f credentials.json ]; then
  echo "==> Initializing empty credentials.json..."
  echo '{}' > credentials.json
fi

if [ ! -f active_datasets.json ]; then
  echo "==> Initializing empty active_datasets.json..."
  echo '[]' > active_datasets.json
fi

if [ ! -f influx_config.json ]; then
  echo "==> Initializing default influx_config.json..."
  cat << 'EOF' > influx_config.json
{
  "url": "http://localhost:8086",
  "token": "",
  "org": "",
  "bucket": "fingrid",
  "enabled": false,
  "interval_minutes": 15
}
EOF
fi

echo ""
echo "==> Done! Next steps:"
echo "  1. Start the collector:  docker compose up -d"
echo "  2. Open the Web UI:      http://\$(hostname -I | awk '{print \$1}'):3001"
echo "  3. Configure your Fingrid Open Data API Key and InfluxDB credentials in Settings"
