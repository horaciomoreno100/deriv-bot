#!/bin/bash
#
# Clean PM2 Error Logs
# Clears old error logs to start fresh monitoring
# Usage: ./scripts/clean-logs.sh [--confirm]
#

set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -E '^DEPLOY_' .env | xargs)
fi

SERVER="${DEPLOY_SERVER:-}"

if [ -z "$SERVER" ]; then
    echo "Error: DEPLOY_SERVER not set in .env"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}       Clean PM2 Error Logs${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo ""

if [ "$1" != "--confirm" ]; then
    echo -e "${YELLOW}⚠️  This will clear all PM2 error logs for:${NC}"
    echo "   - gateway"
    echo "   - telegram"
    echo "   - trader-squeeze-mr"
    echo "   - trader-hybrid-mtf"
    echo "   - trader-fvg-ls-forex"
    echo ""
    echo -e "${CYAN}To confirm, run:${NC}"
    echo -e "${CYAN}  ./scripts/clean-logs.sh --confirm${NC}"
    echo ""
    exit 0
fi

echo -e "${CYAN}Cleaning PM2 error logs on server...${NC}"
echo ""

ssh $SERVER << 'ENDSSH'
    echo "Clearing error logs..."
    
    # Clear PM2 error logs by truncating the log files
    for service in gateway telegram trader-squeeze-mr trader-hybrid-mtf trader-fvg-ls-forex; do
        echo "  → Clearing $service error log..."
        # Find and truncate error log files
        if [ -f "/root/.pm2/logs/${service}-error.log" ]; then
            > "/root/.pm2/logs/${service}-error.log"
            echo "    ✅ Cleared /root/.pm2/logs/${service}-error.log"
        fi
        # Also check for logs in the project directory
        if [ -f "/opt/apps/deriv-bot/logs/${service}-error.log" ]; then
            > "/opt/apps/deriv-bot/logs/${service}-error.log"
            echo "    ✅ Cleared /opt/apps/deriv-bot/logs/${service}-error.log"
        fi
    done
    
    # Also clean old log files (without -mr suffix, etc.)
    echo "  → Cleaning old log files..."
    for old_log in /root/.pm2/logs/trader-squeeze-error.log; do
        if [ -f "$old_log" ]; then
            > "$old_log"
            echo "    ✅ Cleared $old_log"
        fi
    done
    
    echo ""
    echo "✅ Error logs cleared"
    echo ""
    echo "Current error counts (should be 0 or very low):"
    for service in gateway telegram trader-squeeze-mr trader-hybrid-mtf trader-fvg-ls-forex; do
        error_count=$(pm2 logs $service --err --lines 10 --nostream 2>/dev/null | grep -v "^$" | wc -l || echo "0")
        echo "  $service: $error_count errors"
    done
ENDSSH

echo ""
echo -e "${GREEN}✅ Logs cleaned successfully!${NC}"
echo ""
echo -e "${CYAN}Note:${NC} New errors will still be logged. This only clears the old error history."
echo ""

