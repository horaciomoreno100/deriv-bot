#!/bin/bash
#
# Server Monitoring Script
# Monitors PM2 services, logs, and system health
# Usage: ./scripts/monitor-server.sh [--telegram]
#

set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -E '^DEPLOY_|^TELEGRAM_' .env | xargs)
fi

# Configuration
SERVER="${DEPLOY_SERVER:-}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/apps/deriv-bot}"
SEND_TELEGRAM="${1:-}" # --telegram flag

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
REPORT_FILE="monitoring-report-$(date +%Y%m%d-%H%M%S).txt"

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       Server Monitoring Report${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "  Time: ${CYAN}${TIMESTAMP}${NC}"
echo ""

# Function to check service status
check_service_status() {
    local service_name=$1
    local status=$(ssh $SERVER "pm2 jlist | jq -r '.[] | select(.name==\"$service_name\") | .pm2_env.status'")
    local uptime=$(ssh $SERVER "pm2 jlist | jq -r '.[] | select(.name==\"$service_name\") | .pm2_env.pm_uptime'")
    local restarts=$(ssh $SERVER "pm2 jlist | jq -r '.[] | select(.name==\"$service_name\") | .pm2_env.restart_time'")
    local cpu=$(ssh $SERVER "pm2 jlist | jq -r '.[] | select(.name==\"$service_name\") | .monit.cpu'")
    local memory=$(ssh $SERVER "pm2 jlist | jq -r '.[] | select(.name==\"$service_name\") | .monit.memory'")
    
    if [ "$status" == "online" ]; then
        local uptime_sec=$((($(date +%s) * 1000 - $uptime) / 1000))
        local uptime_formatted=$(printf '%dd %dh %dm %ds' $(($uptime_sec/86400)) $(($uptime_sec%86400/3600)) $(($uptime_sec%3600/60)) $(($uptime_sec%60)))
        echo -e "  ${GREEN}🟢${NC} ${service_name}"
        echo -e "     Status: ${GREEN}${status}${NC}"
        echo -e "     Uptime: ${CYAN}${uptime_formatted}${NC}"
        echo -e "     Restarts: ${CYAN}${restarts}${NC}"
        echo -e "     CPU: ${CYAN}${cpu}%${NC} | Memory: ${CYAN}$(($memory / 1024 / 1024))MB${NC}"
    else
        echo -e "  ${RED}🔴${NC} ${service_name}"
        echo -e "     Status: ${RED}${status}${NC}"
    fi
    echo ""
}

# Function to check recent errors
check_recent_errors() {
    local service_name=$1
    local error_count=$(ssh $SERVER "pm2 logs $service_name --err --lines 50 --nostream 2>/dev/null | grep -i 'error\|fatal\|exception' | wc -l" || echo "0")
    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${YELLOW}⚠️  ${service_name}: ${error_count} recent errors${NC}"
        # Show last 3 errors
        echo -e "     Last errors:"
        ssh $SERVER "pm2 logs $service_name --err --lines 10 --nostream 2>/dev/null | grep -i 'error\|fatal\|exception' | tail -3 | sed 's/^/       /'" || true
    fi
}

# Generate report
{
    echo "═══════════════════════════════════════════════════"
    echo "       Server Monitoring Report"
    echo "═══════════════════════════════════════════════════"
    echo "Time: ${TIMESTAMP}"
    echo ""
    
    echo "📊 PM2 Services Status:"
    echo ""
    check_service_status "gateway"
    check_service_status "telegram"
    check_service_status "trader-squeeze-mr"
    check_service_status "trader-keltner-mr"
    check_service_status "trader-hybrid-mtf"
    
    echo "⚠️  Recent Errors:"
    echo ""
    check_recent_errors "gateway"
    check_recent_errors "telegram"
    check_recent_errors "trader-squeeze-mr"
    check_recent_errors "trader-keltner-mr"
    check_recent_errors "trader-hybrid-mtf"
    echo ""
    
    echo "💻 System Resources:"
    echo ""
    ssh $SERVER "echo '  CPU Usage:' && top -bn1 | grep 'Cpu(s)' | sed 's/^/    /'"
    ssh $SERVER "echo '  Memory Usage:' && free -h | grep Mem | awk '{print \"    Total: \" \$2 \" | Used: \" \$3 \" | Free: \" \$4}'"
    ssh $SERVER "echo '  Disk Usage:' && df -h / | tail -1 | awk '{print \"    Usage: \" \$5 \" | Available: \" \$4}'"
    echo ""
    
    echo "📈 Recent Activity (last 5 minutes):"
    echo ""
    ssh $SERVER "pm2 logs --lines 20 --nostream 2>/dev/null | grep -E 'Signal|Trade|ERROR|WARN' | tail -10 | sed 's/^/  /'" || echo "  No recent activity"
    echo ""
    
    echo "═══════════════════════════════════════════════════"
    echo "Report generated at: ${TIMESTAMP}"
    echo "═══════════════════════════════════════════════════"
} | tee "$REPORT_FILE"

# Send to Telegram if requested
if [ "$SEND_TELEGRAM" == "--telegram" ]; then
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        echo ""
        echo -e "${CYAN}Sending report to Telegram...${NC}"
        
        # Format report for Telegram (limit to 4096 chars)
        REPORT_CONTENT=$(cat "$REPORT_FILE" | head -c 4000)
        
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="${TELEGRAM_CHAT_ID}" \
            -d text="<pre>${REPORT_CONTENT}</pre>" \
            -d parse_mode="HTML" > /dev/null
        
        echo -e "${GREEN}✓${NC} Report sent to Telegram"
    else
        echo -e "${YELLOW}⚠️  Telegram credentials not configured${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Report saved to: ${CYAN}${REPORT_FILE}${NC}"
echo ""
