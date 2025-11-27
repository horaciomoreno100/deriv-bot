#!/bin/bash
#
# View Latest Monitoring Report
# Usage: ./scripts/view-monitoring.sh [--all]
#

set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -E '^DEPLOY_' .env | xargs)
fi

SERVER="${DEPLOY_SERVER:-}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/apps/deriv-bot}"

if [ -z "$SERVER" ]; then
    echo "Error: DEPLOY_SERVER not set in .env"
    exit 1
fi

if [ "$1" == "--all" ]; then
    echo "📊 All Monitoring Reports:"
    echo ""
    ssh $SERVER "ls -lt ${REMOTE_PATH}/monitoring-reports/report-*.txt 2>/dev/null | head -10 | awk '{print \$NF}' | while read file; do echo \"📄 \$(basename \$file)\"; echo \"   \$(head -1 \$file)\"; echo \"\"; done"
else
    echo "📊 Latest Monitoring Report:"
    echo ""
    ssh $SERVER "ls -t ${REMOTE_PATH}/monitoring-reports/report-*.txt 2>/dev/null | head -1 | xargs cat" || echo "No reports found yet. Wait for the next monitoring cycle (every 15 minutes)."
fi

