#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# setup-dokku.sh — One-click Dokku deployment for Lattice
# Usage:
#   ./setup-dokku.sh --host user@myserver.com --app lattice \
#     [--domain lattice.example.com] \
#     [--scale 3] \
#     [--https --email admin@example.com] \
#     [--push-secret mysecret]
# ---------------------------------------------------------------------------

HOST=""
APP=""
DOMAIN=""
SCALE=1
HTTPS=false
EMAIL=""
PUSH_SECRET=""

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)        HOST="$2";        shift 2 ;;
    --app)         APP="$2";         shift 2 ;;
    --domain)      DOMAIN="$2";      shift 2 ;;
    --scale)       SCALE="$2";       shift 2 ;;
    --https)       HTTPS=true;       shift   ;;
    --email)       EMAIL="$2";       shift 2 ;;
    --push-secret) PUSH_SECRET="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 --host user@server --app <name> [--domain <domain>] [--scale N] [--https --email <email>] [--push-secret <secret>]"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$HOST" || -z "$APP" ]]; then
  echo "Error: --host and --app are required."
  exit 1
fi

if $HTTPS; then
  if [[ -z "$DOMAIN" ]]; then
    echo "Error: --https requires --domain."
    exit 1
  fi
  if [[ -z "$EMAIL" ]]; then
    echo "Error: --https requires --email."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
echo "==> Pre-flight checks..."

for cmd in git ssh; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' is not installed locally."
    exit 1
  fi
done

echo "    Checking Dokku on $HOST..."
if ! ssh "$HOST" "dokku version" &>/dev/null; then
  echo "Error: Cannot reach Dokku on $HOST. Ensure SSH access and Dokku are configured."
  exit 1
fi
echo "    Dokku reachable."

# ---------------------------------------------------------------------------
# App create (idempotent)
# ---------------------------------------------------------------------------
echo "==> Creating app '$APP' (if it doesn't exist)..."
ssh "$HOST" "dokku apps:create $APP 2>/dev/null || true"

# ---------------------------------------------------------------------------
# Port mapping (ensure nginx listens on 80, not the container port)
# ---------------------------------------------------------------------------
echo "==> Setting port mapping (http:80:3000)..."
ssh "$HOST" "dokku ports:set $APP http:80:3000 2>/dev/null || dokku proxy:ports-set $APP http:80:3000"

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------
echo "==> Setting up Redis..."
REDIS_PLUGIN_INSTALLED=$(ssh "$HOST" "dokku plugin:list 2>/dev/null | grep -c 'redis' || true")
if [[ "$REDIS_PLUGIN_INSTALLED" -eq 0 ]]; then
  echo "    Installing dokku-redis plugin..."
  ssh "$HOST" "sudo dokku plugin:install https://github.com/dokku/dokku-redis.git redis"
fi

REDIS_SERVICE="$APP-redis"
echo "    Creating Redis service '$REDIS_SERVICE' (if it doesn't exist)..."
ssh "$HOST" "dokku redis:create $REDIS_SERVICE 2>/dev/null || true"

echo "    Linking Redis to app (if not already linked)..."
ssh "$HOST" "dokku redis:link $REDIS_SERVICE $APP 2>/dev/null || true"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
echo "==> Configuring app..."

if [[ -z "$PUSH_SECRET" ]]; then
  if $HTTPS; then
    read -rp "Enter PUSH_SECRET (used to authenticate push requests): " PUSH_SECRET
  else
    PUSH_SECRET="dev-push-secret"
    echo "    No --push-secret provided; using default: $PUSH_SECRET"
  fi
fi

ssh "$HOST" "dokku config:set --no-restart $APP PUSH_SECRET=$PUSH_SECRET"

# ---------------------------------------------------------------------------
# Domain
# ---------------------------------------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  echo "==> Setting domain to '$DOMAIN'..."
  ssh "$HOST" "dokku domains:set $APP $DOMAIN"
fi

# ---------------------------------------------------------------------------
# Git remote + deploy
# ---------------------------------------------------------------------------
echo "==> Deploying to Dokku..."

DOKKU_REMOTE="dokku@$HOST:$APP"
# Strip the user@ prefix to get just the host for the git remote URL
DOKKU_HOST="${HOST#*@}"
DOKKU_REMOTE="dokku@${DOKKU_HOST}:${APP}"

if git remote get-url dokku &>/dev/null; then
  git remote set-url dokku "$DOKKU_REMOTE"
  echo "    Updated existing 'dokku' remote."
else
  git remote add dokku "$DOKKU_REMOTE"
  echo "    Added 'dokku' remote."
fi

git push dokku HEAD:main

# ---------------------------------------------------------------------------
# Scale
# ---------------------------------------------------------------------------
if [[ "$SCALE" -gt 1 ]]; then
  echo "==> Scaling web process to $SCALE instances..."
  ssh "$HOST" "dokku ps:scale $APP web=$SCALE"
fi

# ---------------------------------------------------------------------------
# HTTPS / Let's Encrypt
# ---------------------------------------------------------------------------
if $HTTPS; then
  echo "==> Setting up HTTPS with Let's Encrypt..."

  LE_PLUGIN_INSTALLED=$(ssh "$HOST" "dokku plugin:list 2>/dev/null | grep -c 'letsencrypt' || true")
  if [[ "$LE_PLUGIN_INSTALLED" -eq 0 ]]; then
    echo "    Installing dokku-letsencrypt plugin..."
    ssh "$HOST" "sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git"
  fi

  ssh "$HOST" "dokku letsencrypt:set $APP email $EMAIL"
  ssh "$HOST" "dokku letsencrypt:enable $APP"
  echo "    HTTPS enabled."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Deployment complete!"

if $HTTPS && [[ -n "$DOMAIN" ]]; then
  BASE_URL="https://$DOMAIN"
else
  BASE_URL="http://$DOKKU_HOST"
fi

echo ""
echo "    App URL : $BASE_URL"
echo "    Health  : curl $BASE_URL/"
echo ""
echo "    SSE test:"
echo "      curl -N -H 'Accept: text/event-stream' $BASE_URL/sse/<agent-id>"
echo ""
echo "    Push test:"
echo "      curl -X POST $BASE_URL/push/<agent-id> \\"
echo "        -H 'Authorization: Bearer $PUSH_SECRET' \\"
echo "        -H 'Content-Type: application/json' \\"
echo "        -d '{\"message\": \"hello\"}'"
