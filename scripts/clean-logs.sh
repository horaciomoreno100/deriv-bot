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
    echo "   - trader-keltner-mr"
    echo "   - trader-hybrid-mtf"
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
    
    for service in gateway telegram trader-squeeze-mr trader-keltner-mr trader-hybrid-mtf; do
        echo "  → Clearing $service error log..."
        pm2 flush $service --err 2>/dev/null || echo "    (No errors to clear)"
    done
    
    echo ""
    echo "✅ Error logs cleared"
    echo ""
    echo "Current error counts:"
    for service in gateway telegram trader-squeeze-mr trader-keltner-mr trader-hybrid-mtf; do
        error_count=$(pm2 logs $service --err --lines 10 --nostream 2>/dev/null | wc -l || echo "0")
        echo "  $service: $error_count errors"
    done
ENDSSH

echo ""
echo -e "${GREEN}✅ Logs cleaned successfully!${NC}"
echo ""
echo -e "${CYAN}Note:${NC} New errors will still be logged. This only clears the old error history."
echo ""

