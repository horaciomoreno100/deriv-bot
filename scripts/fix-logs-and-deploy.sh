#!/bin/bash
#
# Fix Logs and Deploy
# 
# This script:
# 1. Compiles the gateway with log filters
# 2. Cleans old error logs on the server
# 3. Deploys the changes
# 4. Restarts services
#
# Usage: ./scripts/fix-logs-and-deploy.sh

set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -E '^DEPLOY_' .env | xargs)
fi

SERVER="${DEPLOY_SERVER:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/apps/deriv-bot}"

if [ -z "$SERVER" ]; then
    echo "Error: DEPLOY_SERVER not set in .env"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       Fix Logs and Deploy${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Build Gateway
echo -e "${CYAN}[1/4] Building Gateway with log filters...${NC}"
pnpm --filter @deriv-bot/gateway build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Gateway built successfully${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Clean old logs on server
echo -e "${CYAN}[2/4] Cleaning old error logs on server...${NC}"
ssh $SERVER << 'ENDSSH'
    echo "Clearing PM2 error logs..."
    
    # Clear PM2 logs using pm2 flush (clears all logs)
    pm2 flush
    
    # Also manually clear specific log files to be sure
    for service in gateway telegram trader-squeeze-mr trader-hybrid-mtf trader-fvg-ls-forex; do
        # Clear PM2 logs
        if [ -f "/root/.pm2/logs/${service}-error.log" ]; then
            > "/root/.pm2/logs/${service}-error.log"
        fi
        if [ -f "/root/.pm2/logs/${service}-out.log" ]; then
            > "/root/.pm2/logs/${service}-out.log"
        fi
        # Clear project logs if they exist
        if [ -f "/opt/apps/deriv-bot/logs/${service}-error.log" ]; then
            > "/opt/apps/deriv-bot/logs/${service}-error.log"
        fi
        if [ -f "/opt/apps/deriv-bot/logs/${service}-out.log" ]; then
            > "/opt/apps/deriv-bot/logs/${service}-out.log"
        fi
    done
    
    echo "✅ Logs cleared"
ENDSSH

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Logs cleaned successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Some log files may not have been cleared${NC}"
fi
echo ""

# Step 3: Deploy changes
echo -e "${CYAN}[3/4] Deploying changes to server...${NC}"
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude 'dist' \
    --exclude 'backtest-data' \
    --exclude 'analysis-output' \
    --exclude 'charts' \
    --exclude 'data' \
    packages/gateway/dist/ \
    $SERVER:$DEPLOY_PATH/packages/gateway/dist/

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Files deployed successfully${NC}"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi
echo ""

# Step 4: Restart services
echo -e "${CYAN}[4/4] Restarting services...${NC}"
ssh $SERVER << 'ENDSSH'
    echo "Restarting gateway and traders..."
    pm2 restart gateway trader-hybrid-mtf trader-squeeze-mr trader-fvg-ls-forex
    pm2 save
    echo "✅ Services restarted"
    
    # Show status
    echo ""
    echo "Service status:"
    pm2 status | grep -E "gateway|trader|telegram"
ENDSSH

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Services restarted successfully${NC}"
else
    echo -e "${RED}❌ Failed to restart services${NC}"
    exit 1
fi
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}       ✅ All done!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Wait a few seconds for services to start"
echo "  2. Check Telegram: /errors 50"
echo "  3. The old error logs should be gone"
echo "  4. New errors (if any) will be filtered automatically"
echo ""

