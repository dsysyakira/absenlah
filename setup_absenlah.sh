#!/usr/bin/env bash
# =============================================================================
#  setup_absenlah.sh  —  All-in-One Deployment Script for the Absenlah App
#  Target OS:    Ubuntu 22.04 LTS
#  Author:       Absenlah DevOps
#  Version:      1.0.0
#  Description:  Prepares system, clones repo, wizards .env, deploys Docker
#                stack (Pocketbase + Nginx), and builds mobile artifacts.
#
#  Usage:
#     chmod +x setup_absenlah.sh
#     sudo ./setup_absenlah.sh --all             # run every step
#     sudo ./setup_absenlah.sh --prep            # only environment prep
#     sudo ./setup_absenlah.sh --clone           # only clone repo
#     sudo ./setup_absenlah.sh --configure       # only env wizard
#     sudo ./setup_absenlah.sh --deploy          # only docker + nginx deploy
#     sudo ./setup_absenlah.sh --build           # only build mobile artifacts
#     sudo ./setup_absenlah.sh --rollback        # manually trigger rollback
#     sudo ./setup_absenlah.sh --stack expo      # force Expo build path
#     sudo ./setup_absenlah.sh --stack flutter   # force Flutter build path
#     sudo ./setup_absenlah.sh --help
# =============================================================================

set -Eeuo pipefail

# -------------------------- Constants & Paths --------------------------------
readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALL_ROOT="/opt/absenlah"
readonly BUILD_OUTPUT_DIR="${INSTALL_ROOT}/build_output"
readonly LOG_FILE="${INSTALL_ROOT}/install.log"
readonly ENV_FILE="${INSTALL_ROOT}/.env"
readonly DOCKER_COMPOSE_FILE="${INSTALL_ROOT}/docker-compose.yml"
readonly NGINX_CONF_FILE="${INSTALL_ROOT}/nginx.conf"
readonly STATE_FILE="${INSTALL_ROOT}/.setup_state"
readonly NODE_MAJOR="20"
readonly FLUTTER_VERSION="3.24.5"
readonly FLUTTER_INSTALL_DIR="/opt/flutter"

# -------------------------- Terminal Colors ----------------------------------
if [[ -t 1 ]]; then
    readonly C_RESET='\033[0m'
    readonly C_RED='\033[0;31m'
    readonly C_GREEN='\033[0;32m'
    readonly C_YELLOW='\033[0;33m'
    readonly C_BLUE='\033[0;34m'
    readonly C_CYAN='\033[0;36m'
    readonly C_BOLD='\033[1m'
else
    readonly C_RESET='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_CYAN='' C_BOLD=''
fi

# -------------------------- Global Flags -------------------------------------
DO_PREP=0
DO_CLONE=0
DO_CONFIG=0
DO_DEPLOY=0
DO_BUILD=0
DO_ROLLBACK=0
STACK_OVERRIDE=""       # "expo" | "flutter" | ""
CURRENT_STEP="init"     # tracked for rollback

# -------------------------- Logging ------------------------------------------
mkdir -p "$INSTALL_ROOT" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || true

_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log()  { echo -e "$(_ts) [INFO ] $*"                   | tee -a "$LOG_FILE"; }
ok()   { echo -e "$(_ts) [ ${C_GREEN}OK${C_RESET}  ] ${C_GREEN}$*${C_RESET}"   | tee -a "$LOG_FILE"; }
warn() { echo -e "$(_ts) [ ${C_YELLOW}WARN${C_RESET} ] ${C_YELLOW}$*${C_RESET}" | tee -a "$LOG_FILE"; }
err()  { echo -e "$(_ts) [${C_RED}ERROR${C_RESET}] ${C_RED}$*${C_RESET}"        | tee -a "$LOG_FILE" >&2; }
hdr()  {
    local msg="$*"
    echo ""
    echo -e "${C_BOLD}${C_CYAN}────────────────────────────────────────────────────────────${C_RESET}" | tee -a "$LOG_FILE"
    echo -e "${C_BOLD}${C_CYAN}▶  ${msg}${C_RESET}" | tee -a "$LOG_FILE"
    echo -e "${C_BOLD}${C_CYAN}────────────────────────────────────────────────────────────${C_RESET}" | tee -a "$LOG_FILE"
}

# -------------------------- Error Trap / Rollback ---------------------------
on_error() {
    local exit_code=$?
    local line_no=$1
    err "Step \"${CURRENT_STEP}\" failed at line ${line_no} (exit ${exit_code})"
    err "Last 20 log lines:"
    tail -n 20 "$LOG_FILE" | sed 's/^/       /' >&2 || true
    perform_rollback
    exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# -------------------------- Helper Utils -------------------------------------
require_root() {
    if [[ $EUID -ne 0 ]]; then
        err "Script must be run as root (use: sudo $SCRIPT_NAME ...)"
        exit 1
    fi
}

command_exists() { command -v "$1" &>/dev/null; }

ask() {
    # Usage: ask "Question" "default"
    local prompt="$1" default="${2:-}" reply
    if [[ -n "$default" ]]; then
        read -r -p "$(echo -e "${C_BOLD}${prompt}${C_RESET} [${C_YELLOW}${default}${C_RESET}]: ")" reply
        echo "${reply:-$default}"
    else
        read -r -p "$(echo -e "${C_BOLD}${prompt}${C_RESET}: ")" reply
        while [[ -z "$reply" ]]; do
            read -r -p "  (required) $(echo -e "${C_BOLD}${prompt}${C_RESET}: ")" reply
        done
        echo "$reply"
    fi
}

ask_secret() {
    # Usage: ask_secret "Prompt"
    local prompt="$1" reply
    read -r -s -p "$(echo -e "${C_BOLD}${prompt}${C_RESET}: ")" reply
    echo "" >&2
    while [[ -z "$reply" ]]; do
        read -r -s -p "  (required) $(echo -e "${C_BOLD}${prompt}${C_RESET}: ")" reply
        echo "" >&2
    done
    echo "$reply"
}

confirm() {
    # Usage: confirm "Question" [Y|N default]
    local prompt="$1" default="${2:-Y}" reply
    local hint="[Y/n]"
    [[ "$default" == "N" ]] && hint="[y/N]"
    read -r -p "$(echo -e "${C_BOLD}${prompt}${C_RESET} ${hint}: ")" reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy]$ ]]
}

record_state() {
    # Persist a state marker for rollback
    echo "$1" >> "$STATE_FILE"
}

# ============================================================================
#  STEP 1 — Environment Preparation
# ============================================================================
step_prep_environment() {
    CURRENT_STEP="prep"
    hdr "STEP 1 — Environment Preparation"

    require_root

    log "Updating apt cache and upgrading system packages"
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

    log "Installing base packages"
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        curl wget git ca-certificates gnupg lsb-release \
        software-properties-common apt-transport-https \
        unzip zip jq openssl ufw build-essential \
        nginx

    # -------- Docker --------
    if ! command_exists docker; then
        log "Installing Docker Engine"
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
            | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
            https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
            > /etc/apt/sources.list.d/docker.list
        apt-get update -y
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        systemctl enable --now docker
        record_state "docker_installed"
        ok "Docker installed"
    else
        ok "Docker already installed ($(docker --version))"
    fi

    # -------- Docker Compose plugin (verify) --------
    if ! docker compose version &>/dev/null; then
        err "docker compose plugin missing after install"
        return 1
    fi

    # -------- Node.js LTS --------
    if ! command_exists node || [[ "$(node -v | grep -oE '[0-9]+' | head -1)" -lt "$NODE_MAJOR" ]]; then
        log "Installing Node.js ${NODE_MAJOR}.x LTS"
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
        npm install -g yarn eas-cli
        record_state "node_installed"
        ok "Node $(node -v), yarn $(yarn -v), eas $(eas --version 2>/dev/null | head -1 || echo n/a)"
    else
        ok "Node.js already installed ($(node -v))"
    fi

    # -------- Flutter SDK (conditional; only if user forces flutter or already exists) --------
    if [[ "$STACK_OVERRIDE" == "flutter" ]] && [[ ! -d "$FLUTTER_INSTALL_DIR" ]]; then
        log "Installing Flutter SDK ${FLUTTER_VERSION}"
        cd /opt
        curl -fsSL -o flutter.tar.xz \
            "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
        tar xf flutter.tar.xz
        rm flutter.tar.xz
        chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" "$FLUTTER_INSTALL_DIR"
        # Add to PATH globally
        echo 'export PATH="$PATH:/opt/flutter/bin"' > /etc/profile.d/flutter.sh
        chmod +x /etc/profile.d/flutter.sh
        export PATH="$PATH:$FLUTTER_INSTALL_DIR/bin"
        sudo -u "${SUDO_USER:-root}" "$FLUTTER_INSTALL_DIR/bin/flutter" --disable-analytics || true
        record_state "flutter_installed"
        ok "Flutter installed at ${FLUTTER_INSTALL_DIR}"
    elif [[ -d "$FLUTTER_INSTALL_DIR" ]]; then
        ok "Flutter already installed"
    fi

    # -------- Nginx --------
    if ! systemctl is-enabled nginx &>/dev/null; then
        systemctl enable --now nginx
    fi
    ok "Nginx active ($(nginx -v 2>&1))"

    # -------- Firewall (optional, safe defaults) --------
    if command_exists ufw; then
        ufw allow OpenSSH >/dev/null 2>&1 || true
        ufw allow 'Nginx Full' >/dev/null 2>&1 || true
    fi

    ok "Environment preparation complete"
}

# ============================================================================
#  STEP 2 — Repository Setup
# ============================================================================
step_clone_repository() {
    CURRENT_STEP="clone"
    hdr "STEP 2 — Repository Setup"

    local repo_url
    repo_url="$(ask "GitHub repository URL (HTTPS or SSH)" "${ABSENLAH_REPO_URL:-}")"

    local branch
    branch="$(ask "Branch to check out" "main")"

    local target_dir="${INSTALL_ROOT}/app"

    # Directory hygiene
    install -d -m 0755 "$INSTALL_ROOT"
    install -d -m 0755 "$BUILD_OUTPUT_DIR"
    install -d -m 0750 "${INSTALL_ROOT}/secrets"
    install -d -m 0755 "${INSTALL_ROOT}/pb_data"
    install -d -m 0755 "${INSTALL_ROOT}/pb_hooks"
    install -d -m 0755 "${INSTALL_ROOT}/pb_migrations"
    install -d -m 0755 "${INSTALL_ROOT}/certs"

    if [[ -d "$target_dir/.git" ]]; then
        log "Repo already cloned; pulling latest on branch $branch"
        git -C "$target_dir" fetch --all --prune
        git -C "$target_dir" checkout "$branch"
        git -C "$target_dir" pull --ff-only origin "$branch"
    else
        log "Cloning $repo_url (branch: $branch) into $target_dir"
        # If HTTPS + private, use GITHUB_TOKEN if set
        if [[ -n "${GITHUB_TOKEN:-}" ]] && [[ "$repo_url" == https://* ]]; then
            local authed_url="${repo_url/https:\/\//https://${GITHUB_TOKEN}@}"
            git clone --branch "$branch" --depth 1 "$authed_url" "$target_dir"
        else
            git clone --branch "$branch" --depth 1 "$repo_url" "$target_dir"
        fi
        record_state "repo_cloned"
    fi

    chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" "$target_dir"
    ok "Repository ready at $target_dir"
}

# ============================================================================
#  STEP 3 — Configuration Wizard
# ============================================================================
step_configure_env() {
    CURRENT_STEP="configure"
    hdr "STEP 3 — Configuration Wizard"

    if [[ -f "$ENV_FILE" ]]; then
        if ! confirm ".env already exists at $ENV_FILE — overwrite?" "N"; then
            ok "Keeping existing .env"
            return 0
        fi
    fi

    log "Please answer the following configuration questions."

    local domain
    domain="$(ask "Public domain (e.g. absenlah.example.com)" "absenlah.local")"

    local admin_email
    admin_email="$(ask "Admin email (for Pocketbase superuser + Let's Encrypt)" "admin@${domain}")"

    local admin_password
    admin_password="$(ask_secret "Admin password (Pocketbase superuser + Absenlah admin)")"

    local db_url
    db_url="$(ask "Database URL (leave default for embedded Pocketbase SQLite)" "sqlite:///pb/pb_data/data.db")"

    local jwt_secret
    if confirm "Auto-generate a strong JWT secret?" "Y"; then
        jwt_secret="$(openssl rand -hex 48)"
        log "Generated JWT_SECRET (48 bytes)"
    else
        jwt_secret="$(ask_secret "JWT secret")"
    fi

    local github_token
    read -r -s -p "$(echo -e "${C_BOLD}GitHub token (optional, press Enter to skip)${C_RESET}: ")" github_token
    echo ""

    local api_key
    read -r -s -p "$(echo -e "${C_BOLD}External API key (optional, e.g. EMERGENT_LLM_KEY)${C_RESET}: ")" api_key
    echo ""

    local tz
    tz="$(ask "Server timezone" "Asia/Jakarta")"

    local enable_ssl
    if confirm "Enable HTTPS via Let's Encrypt (requires public domain + port 80/443)?" "Y"; then
        enable_ssl="true"
    else
        enable_ssl="false"
    fi

    # Write .env atomically
    local tmp_env
    tmp_env="$(mktemp)"
    cat > "$tmp_env" <<EOF
# =============================================================
#  Absenlah — Environment Configuration
#  Generated on $(date)
# =============================================================
DOMAIN=${domain}
TZ=${tz}
ADMIN_EMAIL=${admin_email}
ADMIN_PASSWORD=${admin_password}
DB_URL=${db_url}
JWT_SECRET=${jwt_secret}
GITHUB_TOKEN=${github_token}
API_KEY=${api_key}
ENABLE_SSL=${enable_ssl}

# Pocketbase
POCKETBASE_ADMIN_EMAIL=${admin_email}
POCKETBASE_ADMIN_PASSWORD=${admin_password}

# Expo frontend (build-time)
EXPO_PUBLIC_BACKEND_URL=https://${domain}
EOF
    install -m 0600 "$tmp_env" "$ENV_FILE"
    rm -f "$tmp_env"
    chown root:root "$ENV_FILE"
    record_state "env_written"
    ok "Wrote $ENV_FILE (mode 0600)"
}

# ============================================================================
#  STEP 4 — Backend & Frontend Deployment (Docker + Nginx)
# ============================================================================
step_deploy_services() {
    CURRENT_STEP="deploy"
    hdr "STEP 4 — Backend & Nginx Deployment"

    [[ -f "$ENV_FILE" ]] || { err "Missing $ENV_FILE — run --configure first"; return 1; }

    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a

    # ---- docker-compose.yml ----
    log "Writing $DOCKER_COMPOSE_FILE"
    cat > "$DOCKER_COMPOSE_FILE" <<'YAML'
version: "3.9"

services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    container_name: absenlah_pocketbase
    restart: unless-stopped
    environment:
      TZ: ${TZ}
    volumes:
      - ./pb_data:/pb/pb_data
      - ./pb_hooks:/pb/pb_hooks
      - ./pb_migrations:/pb/pb_migrations
    expose:
      - "8090"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8090/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:1.25-alpine
    container_name: absenlah_nginx
    restart: unless-stopped
    depends_on:
      - pocketbase
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
      - ./certbot-webroot:/var/www/certbot:ro
YAML

    # ---- nginx.conf ----
    log "Writing $NGINX_CONF_FILE (SSL=${ENABLE_SSL})"
    if [[ "${ENABLE_SSL}" == "true" ]]; then
        cat > "$NGINX_CONF_FILE" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass         http://pocketbase:8090/api/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
    location /_/ {
        proxy_pass         http://pocketbase:8090/_/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX
    else
        cat > "$NGINX_CONF_FILE" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 20m;

    location /api/ {
        proxy_pass         http://pocketbase:8090/api/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location /_/ {
        proxy_pass         http://pocketbase:8090/_/;
        proxy_set_header   Host \$host;
    }
}
NGINX
    fi

    # ---- Let's Encrypt (optional) ----
    if [[ "${ENABLE_SSL}" == "true" ]]; then
        if [[ ! -f "${INSTALL_ROOT}/certs/fullchain.pem" ]]; then
            log "Obtaining TLS certificate for ${DOMAIN} via certbot standalone"
            DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
            # Stop host nginx if running to free :80
            systemctl stop nginx || true
            certbot certonly --standalone --non-interactive --agree-tos \
                -m "${ADMIN_EMAIL}" -d "${DOMAIN}" || {
                warn "Certbot failed; falling back to self-signed for now"
                openssl req -x509 -nodes -days 90 -newkey rsa:2048 \
                    -keyout "${INSTALL_ROOT}/certs/privkey.pem" \
                    -out    "${INSTALL_ROOT}/certs/fullchain.pem" \
                    -subj "/CN=${DOMAIN}"
            }
            if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
                cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${INSTALL_ROOT}/certs/fullchain.pem"
                cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"   "${INSTALL_ROOT}/certs/privkey.pem"
            fi
        else
            ok "TLS certificate already present"
        fi
    fi

    # ---- Disable host nginx (containerized nginx binds :80/:443) ----
    systemctl stop nginx || true
    systemctl disable nginx || true

    log "Starting docker compose stack"
    cd "$INSTALL_ROOT"
    docker compose --env-file "$ENV_FILE" -f "$DOCKER_COMPOSE_FILE" up -d --remove-orphans
    record_state "compose_up"

    log "Waiting for Pocketbase health..."
    local retries=30
    while ((retries > 0)); do
        if docker exec absenlah_pocketbase wget --spider -q http://localhost:8090/api/health; then
            ok "Pocketbase is healthy"
            break
        fi
        ((retries--))
        sleep 2
    done
    ((retries > 0)) || { err "Pocketbase failed health check"; return 1; }

    # ---- Seed Pocketbase admin (idempotent) ----
    log "Seeding Pocketbase admin user"
    docker exec absenlah_pocketbase /pb/pocketbase superuser upsert \
        "${POCKETBASE_ADMIN_EMAIL}" "${POCKETBASE_ADMIN_PASSWORD}" 2>>"$LOG_FILE" || \
        warn "Superuser seed skipped (already exists or Pocketbase API mismatch)"

    ok "Deployment complete — https://${DOMAIN}/ ready"
}

# ============================================================================
#  STEP 5 — Automated Build Pipeline
# ============================================================================
detect_stack() {
    if [[ -n "$STACK_OVERRIDE" ]]; then
        echo "$STACK_OVERRIDE"
        return
    fi
    local app_dir="${INSTALL_ROOT}/app"
    if [[ -f "${app_dir}/pubspec.yaml" ]]; then
        echo "flutter"
    elif [[ -f "${app_dir}/package.json" ]] || [[ -f "${app_dir}/frontend/package.json" ]]; then
        echo "expo"
    else
        echo "unknown"
    fi
}

step_build_mobile() {
    CURRENT_STEP="build"
    hdr "STEP 5 — Automated Mobile Build"

    local stack app_dir out_dir
    stack="$(detect_stack)"
    app_dir="${INSTALL_ROOT}/app"
    out_dir="${BUILD_OUTPUT_DIR}/$(date +%Y%m%d-%H%M%S)"
    install -d -m 0755 "$out_dir"

    log "Detected stack: $stack"

    case "$stack" in
        flutter)
            build_flutter "$app_dir" "$out_dir"
            ;;
        expo)
            build_expo "$app_dir" "$out_dir"
            ;;
        *)
            err "Unable to detect stack. Use --stack expo or --stack flutter"
            return 1
            ;;
    esac

    # Symlink 'latest' pointer
    ln -sfn "$out_dir" "${BUILD_OUTPUT_DIR}/latest"
    record_state "build_done"
    ok "Artifacts organized under $out_dir (symlinked as latest)"
}

build_flutter() {
    local app_dir="$1" out_dir="$2"
    export PATH="$PATH:${FLUTTER_INSTALL_DIR}/bin"
    command_exists flutter || { err "flutter not on PATH"; return 1; }

    cd "$app_dir"
    log "flutter pub get"
    flutter pub get

    log "flutter build apk --release"
    # Placeholder signing configuration:
    #   android/app/build.gradle expects a keystore properties file, and
    #   android/key.properties should be provided via secrets/.
    #   Example (uncomment when your key.properties exists):
    #     export KEYSTORE_FILE="${INSTALL_ROOT}/secrets/upload-keystore.jks"
    #     export KEYSTORE_PASSWORD="<STORE_PW>"
    #     export KEY_ALIAS="<ALIAS>"
    #     export KEY_PASSWORD="<KEY_PW>"
    flutter build apk --release
    find build/app/outputs/flutter-apk -name "*.apk" -exec cp {} "$out_dir/" \;

    if [[ "${BUILD_IOS:-false}" == "true" ]]; then
        # iOS builds require macOS + Xcode; on Ubuntu this will fail and be skipped.
        log "flutter build ipa --release (requires macOS)"
        flutter build ipa --release || warn "IPA build skipped (needs macOS/Xcode)"
        find build/ios/ipa -name "*.ipa" -exec cp {} "$out_dir/" \; 2>/dev/null || true
    fi
    ok "Flutter build completed"
}

build_expo() {
    local app_dir="$1" out_dir="$2"

    # Find the actual frontend dir (supports monorepo layout)
    local fe_dir
    if [[ -f "${app_dir}/frontend/package.json" ]]; then
        fe_dir="${app_dir}/frontend"
    else
        fe_dir="${app_dir}"
    fi
    cd "$fe_dir"

    log "yarn install"
    yarn install --frozen-lockfile

    # Inject production backend URL from .env
    if [[ -f "$ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        {
            echo "EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL:-https://${DOMAIN}}"
        } > .env.production
    fi

    if [[ -z "${EXPO_TOKEN:-}" ]]; then
        warn "EXPO_TOKEN not set — cannot run cloud EAS build."
        warn "Options: (a) export EXPO_TOKEN and rerun --build, (b) use local build via 'eas build --local' (needs Android SDK + Xcode)."
        warn "Skipping cloud build; falling back to expo prebuild + a documentation stub."
        yarn expo prebuild --clean || warn "Prebuild failed; check logs"
        echo "See ${LOG_FILE} — a production build requires EAS credentials." > "${out_dir}/README.txt"
        return 0
    fi

    log "eas build --platform android --profile production --non-interactive"
    npx eas-cli build --platform android --profile production --non-interactive --no-wait \
        | tee -a "$LOG_FILE"

    log "eas build --platform ios --profile production --non-interactive"
    npx eas-cli build --platform ios --profile production --non-interactive --no-wait \
        | tee -a "$LOG_FILE" || warn "iOS build skipped/failed (needs Apple credentials)"

    # Cloud builds don't produce local artifacts immediately.
    # Instead, record the build IDs so ops can `eas build:list --json` later.
    npx eas-cli build:list --limit 5 --json > "${out_dir}/eas-builds.json" 2>>"$LOG_FILE" || true
    echo "EAS builds have been queued. Track them with:  eas build:list" > "${out_dir}/README.txt"
    ok "Expo (EAS) build submitted; see ${out_dir}/eas-builds.json"
}

# ============================================================================
#  ROLLBACK
# ============================================================================
perform_rollback() {
    hdr "ROLLBACK — undoing changes for failed step: ${CURRENT_STEP}"
    if [[ ! -f "$STATE_FILE" ]]; then
        warn "No state file — nothing to roll back"
        return
    fi

    # Reverse-order rollback based on markers
    tac "$STATE_FILE" | while read -r marker; do
        case "$marker" in
            compose_up)
                warn "Stopping docker compose stack"
                docker compose -f "$DOCKER_COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans || true
                ;;
            env_written)
                warn "Backing up .env to .env.failed"
                mv "$ENV_FILE" "${ENV_FILE}.failed.$(date +%s)" 2>/dev/null || true
                ;;
            repo_cloned)
                warn "Leaving cloned repo intact (safe to inspect)"
                ;;
            build_done)
                warn "Removing incomplete build artifacts"
                rm -rf "${BUILD_OUTPUT_DIR:?}/latest" 2>/dev/null || true
                ;;
            *) : ;;
        esac
    done
    warn "Full log: $LOG_FILE"
    warn "State file preserved at $STATE_FILE for inspection"
}

# ============================================================================
#  ORCHESTRATION
# ============================================================================
usage() {
    cat <<USAGE
${C_BOLD}${SCRIPT_NAME}${C_RESET} — Absenlah all-in-one deploy script

  ${C_CYAN}--all${C_RESET}         Run every step in sequence (prep → clone → configure → deploy → build)
  ${C_CYAN}--prep${C_RESET}        System prep only
  ${C_CYAN}--clone${C_RESET}       Clone repository only
  ${C_CYAN}--configure${C_RESET}   Environment wizard only
  ${C_CYAN}--deploy${C_RESET}      Docker compose + Nginx only
  ${C_CYAN}--build${C_RESET}       Mobile artifact build only
  ${C_CYAN}--rollback${C_RESET}    Manually undo the most recent run
  ${C_CYAN}--stack${C_RESET} expo|flutter   Force build stack (default: auto-detect)
  ${C_CYAN}--help${C_RESET}        Show this message

Logs: ${LOG_FILE}
Install root: ${INSTALL_ROOT}
USAGE
}

parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all)        DO_PREP=1; DO_CLONE=1; DO_CONFIG=1; DO_DEPLOY=1; DO_BUILD=1 ;;
            --prep)       DO_PREP=1 ;;
            --clone)      DO_CLONE=1 ;;
            --configure)  DO_CONFIG=1 ;;
            --deploy)     DO_DEPLOY=1 ;;
            --build)      DO_BUILD=1 ;;
            --rollback)   DO_ROLLBACK=1 ;;
            --stack)      shift; STACK_OVERRIDE="${1:-}" ;;
            --help|-h)    usage; exit 0 ;;
            *) err "Unknown flag: $1"; usage; exit 1 ;;
        esac
        shift
    done
}

main() {
    parse_args "$@"

    if (( DO_ROLLBACK )); then
        perform_rollback
        exit 0
    fi

    require_root

    hdr "Absenlah installer — start at $(date)"
    log "Install root : $INSTALL_ROOT"
    log "Log file     : $LOG_FILE"
    log "Stack        : ${STACK_OVERRIDE:-auto}"

    (( DO_PREP    )) && step_prep_environment
    (( DO_CLONE   )) && step_clone_repository
    (( DO_CONFIG  )) && step_configure_env
    (( DO_DEPLOY  )) && step_deploy_services
    (( DO_BUILD   )) && step_build_mobile

    hdr "ALL REQUESTED STEPS COMPLETED"
    ok "Finished at $(date)"
    ok "Logs         : $LOG_FILE"
    ok "Build output : $BUILD_OUTPUT_DIR/latest"
}

main "$@"
