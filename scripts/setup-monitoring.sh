#!/bin/bash
#
# Setup Server Monitoring Cron Job
# This script sets up a cron job to monitor the server every 15 minutes
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

echo "Setting up monitoring cron job on server..."

# Create monitoring script on server
ssh $SERVER << 'ENDSSH'
cat > /opt/apps/deriv-bot/scripts/server-monitor.sh << 'EOF'
#!/bin/bash
#
# Server-side monitoring script
# Runs on the server and generates a report
#

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
REPORT_DIR="/opt/apps/deriv-bot/monitoring-reports"
mkdir -p "$REPORT_DIR"

REPORT_FILE="$REPORT_DIR/report-$(date +%Y%m%d-%H%M%S).txt"

{
    echo "═══════════════════════════════════════════════════"
    echo "       Server Monitoring Report"
    echo "═══════════════════════════════════════════════════"
    echo "Time: ${TIMESTAMP}"
    echo ""
    
    echo "📊 PM2 Services Status:"
    echo ""
    pm2 jlist | jq -r '.[] | "\(.name)|\(.pm2_env.status)|\(.pm2_env.pm_uptime)|\(.pm2_env.restart_time)|\(.monit.cpu)|\(.monit.memory)"' | while IFS='|' read -r name status uptime restarts cpu memory; do
        if [ "$status" == "online" ]; then
            uptime_sec=$((($(date +%s) * 1000 - $uptime) / 1000))
            uptime_formatted=$(printf '%dd %dh %dm %ds' $(($uptime_sec/86400)) $(($uptime_sec%86400/3600)) $(($uptime_sec%3600/60)) $(($uptime_sec%60)))
            echo "  🟢 $name"
            echo "     Status: $status"
            echo "     Uptime: $uptime_formatted"
            echo "     Restarts: $restarts"
            echo "     CPU: ${cpu}% | Memory: $(($memory / 1024 / 1024))MB"
        else
            echo "  🔴 $name"
            echo "     Status: $status"
        fi
        echo ""
    done
    
    echo "⚠️  Recent Errors (last 10 minutes):"
    echo ""
    has_errors=false
    for service in gateway telegram trader-squeeze-mr trader-hybrid-mtf trader-fvg-ls-forex; do
        # Check if error log file exists and has content
        error_log_pm2="/root/.pm2/logs/${service}-error.log"
        error_log_app="/opt/apps/deriv-bot/logs/${service}-error.log"
        
        # Count actual error lines (excluding empty lines and headers)
        error_count=0
        if [ -f "$error_log_pm2" ] && [ -s "$error_log_pm2" ]; then
            error_count=$(grep -v '^[[:space:]]*$' "$error_log_pm2" | grep -v 'TAILING' | grep -v 'last.*lines' | wc -l || echo "0")
        fi
        if [ -f "$error_log_app" ] && [ -s "$error_log_app" ]; then
            app_errors=$(grep -v '^[[:space:]]*$' "$error_log_app" | grep -v 'TAILING' | grep -v 'last.*lines' | wc -l || echo "0")
            error_count=$((error_count + app_errors))
        fi
        
        # Only show if there are actual errors
        if [ "$error_count" -gt 0 ]; then
            has_errors=true
            echo "  ⚠️  $service: $error_count errors"
            # Show last 2 actual error lines (not headers)
            if [ -f "$error_log_pm2" ] && [ -s "$error_log_pm2" ]; then
                grep -v '^[[:space:]]*$' "$error_log_pm2" | grep -v 'TAILING' | grep -v 'last.*lines' | grep -iE 'error|fatal|exception' | tail -2 | sed 's/^/     /' || true
            fi
            if [ -f "$error_log_app" ] && [ -s "$error_log_app" ]; then
                grep -v '^[[:space:]]*$' "$error_log_app" | grep -v 'TAILING' | grep -v 'last.*lines' | grep -iE 'error|fatal|exception' | tail -2 | sed 's/^/     /' || true
            fi
        fi
    done
    
    if [ "$has_errors" = false ]; then
        echo "  ✅ No errors found"
    fi
    echo ""
    
    echo "💻 System Resources:"
    echo ""
    echo "  CPU: $(top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\([0-9.]*\)%* id.*/\1/' | awk '{print 100 - $1}')%"
    echo "  Memory: $(free | grep Mem | awk '{printf "%.1f%% used (%s/%s)", $3/$2 * 100.0, $3, $2}')"
    echo "  Disk: $(df -h / | tail -1 | awk '{print $5 " used (" $4 " free)"}')"
    echo ""
    
    echo "📈 Recent Activity:"
    echo ""
    pm2 logs --lines 30 --nostream 2>/dev/null | grep -E 'Signal|Trade|ERROR|WARN' | tail -10 | sed 's/^/  /' || echo "  No recent activity"
    echo ""
    
    echo "═══════════════════════════════════════════════════"
} > "$REPORT_FILE"

# Keep only last 100 reports
cd "$REPORT_DIR"
ls -t report-*.txt | tail -n +101 | xargs -r rm

echo "Report saved to: $REPORT_FILE"
EOF

chmod +x /opt/apps/deriv-bot/scripts/server-monitor.sh

# Add cron job (every 15 minutes)
(crontab -l 2>/dev/null | grep -v "server-monitor.sh"; echo "*/15 * * * * /opt/apps/deriv-bot/scripts/server-monitor.sh >> /opt/apps/deriv-bot/monitoring-reports/cron.log 2>&1") | crontab -

echo "✅ Monitoring cron job installed"
echo "   Reports will be saved to: /opt/apps/deriv-bot/monitoring-reports/"
echo "   Run manually: /opt/apps/deriv-bot/scripts/server-monitor.sh"
ENDSSH

echo ""
echo "✅ Server monitoring setup complete!"
echo ""
echo "The server will now generate monitoring reports every 15 minutes."
echo "Reports are saved to: /opt/apps/deriv-bot/monitoring-reports/"
echo ""
echo "To view the latest report:"
echo "  ssh $SERVER 'cat /opt/apps/deriv-bot/monitoring-reports/report-*.txt | tail -1'"
echo ""
echo "To view all reports:"
echo "  ssh $SERVER 'ls -lt /opt/apps/deriv-bot/monitoring-reports/report-*.txt | head -10'"
echo ""
