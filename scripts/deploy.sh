#!/bin/bash
#
# Deploy Deriv Bot to Hetzner Server
# Usage: ./scripts/deploy.sh [--restart-all] [--no-restart]
#
# For releases with changelog, use: pnpm release
#

set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -E '^DEPLOY_' .env | xargs)
fi

# Configuration (from .env or defaults)
SERVER="${DEPLOY_SERVER:-}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/apps/deriv-bot}"
DEPLOY_LOG="deploys.log"

# Validate required config
if [ -z "$SERVER" ]; then
    echo "Error: DEPLOY_SERVER not set in .env"
    echo "Add: DEPLOY_SERVER=user@your-server-ip"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get version info
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
DEPLOY_TIME=$(date +"%Y-%m-%d %H:%M:%S")
DEPLOY_ID=$(date +"%Y%m%d_%H%M%S")

echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}       Deriv Bot - Deploy to Production${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Version:  ${CYAN}v${VERSION}${NC}"
echo -e "  Commit:   ${CYAN}${GIT_HASH}${NC}"
echo -e "  Branch:   ${CYAN}${GIT_BRANCH}${NC}"
echo -e "  Server:   ${CYAN}${SERVER}${NC}"
echo -e "  Time:     ${CYAN}${DEPLOY_TIME}${NC}"
echo ""

# Step 1: Build locally
echo -e "${YELLOW}[1/5]${NC} Building packages locally..."
pnpm build
pnpm --filter @deriv-bot/telegram build
echo -e "${GREEN}✓${NC} Build complete"
echo ""

# Step 2: Commit if there are changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}[2/5]${NC} Uncommitted changes detected. Committing..."
    git add -A
    git commit -m "chore: deploy v${VERSION} (${DEPLOY_ID})"
    GIT_HASH=$(git rev-parse --short HEAD)
    echo -e "${GREEN}✓${NC} Changes committed (${GIT_HASH})"
else
    echo -e "${YELLOW}[2/5]${NC} No uncommitted changes"
fi
echo ""

# Step 3: Push to remote
echo -e "${YELLOW}[3/5]${NC} Pushing to GitHub..."
git push origin main
echo -e "${GREEN}✓${NC} Pushed to origin/main"
echo ""

# Step 4: Deploy to server
echo -e "${YELLOW}[4/5]${NC} Deploying to server..."
ssh $SERVER << ENDSSH
    set -e
    cd $REMOTE_PATH

    echo "  → Pulling latest code..."
    git pull origin main

    echo "  → Installing dependencies..."
    pnpm install

    echo "  → Building packages..."
    pnpm build
    pnpm --filter @deriv-bot/telegram build

    echo "  → Done on server"
ENDSSH
echo -e "${GREEN}✓${NC} Code deployed"
echo ""

# Step 5: Restart services
if [[ "$1" == "--no-restart" ]]; then
    echo -e "${YELLOW}[5/5]${NC} Skipping service restart (--no-restart)"
elif [[ "$1" == "--restart-all" ]]; then
    echo -e "${YELLOW}[5/5]${NC} Restarting ALL services..."
    ssh $SERVER "pm2 restart all && pm2 save"
    echo -e "${GREEN}✓${NC} All services restarted"
else
    echo -e "${YELLOW}[5/5]${NC} Restarting services (gateway, traders, telegram)..."
    # Restart only processes that exist, ignore errors for missing ones
    ssh $SERVER "for proc in gateway trader-squeeze-mr trader-hybrid-mtf trader-fvg-ls-forex telegram; do pm2 restart \$proc 2>/dev/null || echo \"  ⚠ Process \$proc not found, skipping...\"; done && pm2 save"
    echo -e "${GREEN}✓${NC} Services restarted"
fi
echo ""

# Log deployment
DEPLOY_ENTRY="${DEPLOY_TIME} | v${VERSION} | ${GIT_HASH} | ${GIT_BRANCH} | ${DEPLOY_ID}"
echo "$DEPLOY_ENTRY" >> "$DEPLOY_LOG"
ssh $SERVER "echo '${DEPLOY_ENTRY}' >> ${REMOTE_PATH}/deploys.log"

# Show status
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}       Deploy Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Deploy ID: ${CYAN}${DEPLOY_ID}${NC}"
echo -e "  Version:   ${CYAN}v${VERSION}${NC}"
echo -e "  Commit:    ${CYAN}${GIT_HASH}${NC}"
echo ""
echo "Service Status:"
ssh $SERVER "pm2 status"
echo ""
echo -e "View logs:      ${YELLOW}ssh $SERVER 'pm2 logs --lines 50'${NC}"
echo -e "Deploy history: ${YELLOW}cat deploys.log${NC}"
echo -e "Release:        ${YELLOW}pnpm release${NC} (generates CHANGELOG.md)"
