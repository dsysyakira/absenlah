#!/usr/bin/env bash
# =============================================================================
#  setup_absenlah.sh  —  All-in-One Deployment Script for the Absenlah App v3.0
# =============================================================================

set -Eeuo pipefail

# -------------------------- Constants & Paths --------------------------------
readonly SCRIPT_NAME="$(basename "$0")"
readonly INSTALL_ROOT="/opt/absenlah"
readonly BUILD_OUTPUT_DIR="${INSTALL_ROOT}/build_output"
readonly LOG_FILE="${INSTALL_ROOT}/install.log"
readonly ENV_FILE="${INSTALL_ROOT}/.env"
readonly DOCKER_COMPOSE_FILE="${INSTALL_ROOT}/docker-compose.yml"
readonly NGINX_CONF_FILE="${INSTALL_ROOT}/nginx.conf"
readonly STATE_FILE="${INSTALL_ROOT}/.setup_state"
readonly NODE_MAJOR="20"

ANDROID_HOME="/opt/android-sdk"
JAVA_HOME_DIR="/usr/lib/jvm/java-17-openjdk-amd64"

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
DO_CLEAN=0
DO_PREP=0
DO_CLONE=0
DO_CONFIG=0
DO_DEPLOY=0
DO_BUILD=0
DO_ROLLBACK=0
STACK_OVERRIDE=""
CURRENT_STEP="init"

# -------------------------- Logging ------------------------------------------
_ts() { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo -e "$(_ts) [INFO ] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "$(_ts) [INFO ] $*"; }
ok()   { echo -e "$(_ts) [ ${C_GREEN}OK${C_RESET}  ] ${C_GREEN}$*${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "$(_ts) [ ${C_GREEN}OK${C_RESET}  ] ${C_GREEN}$*${C_RESET}"; }
warn() { echo -e "$(_ts) [ ${C_YELLOW}WARN${C_RESET} ] ${C_YELLOW}$*${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "$(_ts) [ ${C_YELLOW}WARN${C_RESET} ] ${C_YELLOW}$*${C_RESET}"; }
err()  { echo -e "$(_ts) [${C_RED}ERROR${C_RESET}] ${C_RED}$*${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null >&2 || echo -e "$(_ts) [${C_RED}ERROR${C_RESET}] ${C_RED}$*${C_RESET}" >&2; }
hdr()  {
    local msg="$*"
    echo "" | tee -a "$LOG_FILE" 2>/dev/null || echo ""
    echo -e "${C_BOLD}${C_CYAN}────────────────────────────────────────────────────────────${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null || true
    echo -e "${C_BOLD}${C_CYAN}▶  ${msg}${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${C_BOLD}${C_CYAN}▶  ${msg}${C_RESET}"
    echo -e "${C_BOLD}${C_CYAN}────────────────────────────────────────────────────────────${C_RESET}" | tee -a "$LOG_FILE" 2>/dev/null || true
}

on_error() {
    local exit_code=$?
    local line_no=$1
    err "Step \"${CURRENT_STEP}\" failed at line ${line_no} (exit ${exit_code})"
    perform_rollback
    exit "$exit_code"
}
trap 'on_error $LINENO' ERR

require_root() {
    if [[ $EUID -ne 0 ]]; then
        err "Script must be run as root (use: sudo $SCRIPT_NAME ...)"
        exit 1
    fi
}

command_exists() { command -v "$1" &>/dev/null; }

ask() {
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
    local prompt="$1" default="${2:-Y}" reply
    local hint="[Y/n]"
    [[ "$default" == "N" ]] && hint="[y/N]"
    read -r -p "$(echo -e "${C_BOLD}${prompt}${C_RESET} ${hint}: ")" reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy]$ ]]
}

record_state() {
    [[ -d "$INSTALL_ROOT" ]] || return
    echo "$1" >> "$STATE_FILE"
}

init_dirs() {
    mkdir -p "$INSTALL_ROOT" 2>/dev/null || true
    touch "$LOG_FILE" 2>/dev/null || true
}

# ============================================================================
#  STEP 0 — Clean Previous Installation
# ============================================================================
step_clean_installation() {
    CURRENT_STEP="clean"
    hdr "STEP 0 — Cleaning Previous Installation"

    require_root

    if confirm "PERINGATAN: Ini akan menghapus database, file, dan konfigurasi lama di $INSTALL_ROOT. Lanjutkan?" "N"; then
        log "Stopping old Docker containers if they exist..."
        docker stop absenlah_pocketbase absenlah_mongodb absenlah_fastapi absenlah_nginx 2>/dev/null || true
        docker rm -f absenlah_pocketbase absenlah_mongodb absenlah_fastapi absenlah_nginx 2>/dev/null || true
        docker network prune -f 2>/dev/null || true
        log "Deleting installation root directory ($INSTALL_ROOT)..."
        rm -rf "$INSTALL_ROOT"
        ok "Previous installation successfully wiped."
    else
        warn "Cleaning skipped by user."
    fi
}

# ============================================================================
#  STEP 1 — Environment Preparation
# ============================================================================
step_prep_environment() {
    CURRENT_STEP="prep"
    hdr "STEP 1 — Environment Preparation"

    require_root
    init_dirs

    if [[ ! -f /swapfile ]]; then
        log "Membuat 2GB Swap file untuk optimasi RAM Server..."
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        ok "Swap memory berhasil ditambahkan."
    else
        ok "Swap memory sudah ada."
    fi

    log "Updating apt cache and upgrading system packages"
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

    log "Installing base packages & OpenJDK 17"
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        curl wget git ca-certificates gnupg lsb-release \
        software-properties-common apt-transport-https \
        unzip zip jq openssl ufw build-essential \
        nginx openjdk-17-jdk

    if [[ ! -d "$ANDROID_HOME" ]]; then
        log "Mengunduh dan Menginstal Android SDK..."
        mkdir -p "$ANDROID_HOME/cmdline-tools"
        cd /tmp
        wget -q https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip -O cmdline-tools.zip
        unzip -q cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
        mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

        log "Menyetujui lisensi Android SDK..."
        yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1 || true
        "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
        ok "Android SDK terinstal di $ANDROID_HOME"
    else
        ok "Android SDK sudah terinstal."
    fi

    if ! command_exists docker; then
        log "Installing Docker Engine"
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
        apt-get update -y
        DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        systemctl enable --now docker
        record_state "docker_installed"
        ok "Docker installed"
    else
        ok "Docker already installed ($(docker --version))"
    fi

    if ! command_exists node || [[ "$(node -v | grep -oE '[0-9]+' | head -1)" -lt "$NODE_MAJOR" ]]; then
        log "Installing Node.js ${NODE_MAJOR}.x LTS"
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
        npm install -g yarn eas-cli
        record_state "node_installed"
        ok "Node $(node -v), yarn $(yarn -v)"
    else
        ok "Node.js already installed ($(node -v))"
    fi

    if ! systemctl is-enabled nginx &>/dev/null; then
        systemctl enable --now nginx
    fi
    ok "Nginx active ($(nginx -v 2>&1))"

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
    init_dirs

    local repo_url
    repo_url="$(ask "GitHub repository URL (HTTPS or SSH)" "${ABSENLAH_REPO_URL:-}")"

    local branch
    branch="$(ask "Branch to check out" "main")"

    local target_dir="${INSTALL_ROOT}/app"

    install -d -m 0755 "$INSTALL_ROOT"
    install -d -m 0755 "$BUILD_OUTPUT_DIR"
    install -d -m 0750 "${INSTALL_ROOT}/secrets"
    install -d -m 0755 "${INSTALL_ROOT}/mongo_data"
    install -d -m 0755 "${INSTALL_ROOT}/certs"

    if [[ -d "$target_dir/.git" ]]; then
        log "Repo already cloned; pulling latest on branch $branch"
        git -C "$target_dir" fetch --all --prune
        git -C "$target_dir" checkout "$branch"
        git -C "$target_dir" pull --ff-only origin "$branch"
    else
        log "Cloning $repo_url (branch: $branch) into $target_dir"
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
    init_dirs

    if [[ -f "$ENV_FILE" ]]; then
        if ! confirm ".env already exists at $ENV_FILE — overwrite?" "N"; then
            ok "Keeping existing .env"
            return 0
        fi
    fi

    log "Silakan jawab pengaturan di bawah ini."

    local backend_type
    backend_type="$(ask "Pilih Backend [1] FastAPI+MongoDB (Default), [2] Pocketbase" "1")"
    if [[ "$backend_type" == "2" ]]; then
        BACKEND_ENGINE="pocketbase"
    else
        BACKEND_ENGINE="fastapi"
    fi

    local domain
    domain="$(ask "Public domain (contoh: absenlah.example.com)" "absenlah.local")"

    local admin_email
    admin_email="$(ask "Admin email (untuk Let's Encrypt / Admin User)" "admin@${domain}")"

    local jwt_secret
    if confirm "Auto-generate strong JWT secret?" "Y"; then
        jwt_secret="$(openssl rand -hex 48)"
        log "Generated JWT_SECRET (48 bytes)"
    else
        jwt_secret="$(ask_secret "JWT secret")"
    fi

    local google_client_id
    google_client_id="$(ask "Google Client ID (hit Enter to skip)" "")"
    local google_client_secret
    google_client_secret="$(ask "Google Client Secret (hit Enter to skip)" "")"

    local expo_token
    read -r -s -p "$(echo -e "${C_BOLD}EXPO_TOKEN (Opsional, kosongkan [Enter] jika ingin BARE LOCAL BUILD)${C_RESET}: ")" expo_token
    echo ""

    local build_type
    build_type="$(ask "Pilih Output Build [1] APK (Preview), [2] AAB (Production)" "1")"
    if [[ "$build_type" == "2" ]]; then
        EXPO_BUILD_FORMAT="aab"
        EXPO_BUILD_PROFILE="production"
    else
        EXPO_BUILD_FORMAT="apk"
        EXPO_BUILD_PROFILE="preview"
    fi

    local tz
    tz="$(ask "Server timezone" "Asia/Jakarta")"

    local enable_ssl
    if confirm "Enable HTTPS via Let's Encrypt (requires domain + port 80/443)?" "Y"; then
        enable_ssl="true"
    else
        enable_ssl="false"
    fi

    local tmp_env
    tmp_env="$(mktemp)"
    cat > "$tmp_env" <<EOF
BACKEND_ENGINE=${BACKEND_ENGINE}
DOMAIN=${domain}
TZ=${tz}
ADMIN_EMAIL=${admin_email}
JWT_SECRET=${jwt_secret}
GOOGLE_CLIENT_ID=${google_client_id}
GOOGLE_CLIENT_SECRET=${google_client_secret}
ENABLE_SSL=${enable_ssl}
EXPO_TOKEN=${expo_token}
EXPO_BUILD_FORMAT=${EXPO_BUILD_FORMAT}
EXPO_BUILD_PROFILE=${EXPO_BUILD_PROFILE}

# Backend Config (FastAPI)
MONGO_URL=mongodb://mongodb:27017/absenlah

# Expo frontend (build-time)
EXPO_PUBLIC_BACKEND_URL=https://${domain}
EOF
    install -m 0600 "$tmp_env" "$ENV_FILE"
    rm -f "$tmp_env"
    chown root:root "$ENV_FILE"
    record_state "env_written"
    ok "Wrote $ENV_FILE (mode 0600) — Backend: $BACKEND_ENGINE"
}

# ============================================================================
#  STEP 4 — Backend & Frontend Deployment (Docker + Nginx)
# ============================================================================
step_deploy_services() {
    CURRENT_STEP="deploy"
    hdr "STEP 4 — Backend & Nginx Deployment"
    init_dirs

    [[ -f "$ENV_FILE" ]] || { err "Missing $ENV_FILE — run --configure first"; return 1; }
    set -a; source "$ENV_FILE"; set +a

    log "Writing $DOCKER_COMPOSE_FILE"

    if [[ "$BACKEND_ENGINE" == "fastapi" ]]; then
        cat > "$DOCKER_COMPOSE_FILE" <<'YAML'
version: "3.9"
services:
  mongodb:
    image: mongo:6.0
    container_name: absenlah_mongodb
    restart: unless-stopped
    volumes:
      - ./mongo_data:/data/db
    deploy:
      resources:
        limits:
          memory: 512M
    expose:
      - "27017"

  fastapi:
    build:
      context: ./app/backend
    container_name: absenlah_fastapi
    restart: unless-stopped
    depends_on:
      - mongodb
    environment:
      - MONGO_URL=mongodb://mongodb:27017/absenlah
      - DB_NAME=absenlah
      - SECRET_KEY=${JWT_SECRET}
      - TZ=${TZ}
    expose:
      - "8000"

  nginx:
    image: nginx:1.25-alpine
    container_name: absenlah_nginx
    restart: unless-stopped
    depends_on:
      - fastapi
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
      - ./certbot-webroot:/var/www/certbot:ro
YAML
    else
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
    expose:
      - "8090"

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
    fi

    log "Writing $NGINX_CONF_FILE (SSL=${ENABLE_SSL}, Backend=${BACKEND_ENGINE})"
    local backend_proxy="http://fastapi:8000"
    if [[ "$BACKEND_ENGINE" == "pocketbase" ]]; then
        backend_proxy="http://pocketbase:8090"
    fi

    if [[ "${ENABLE_SSL}" == "true" ]]; then
        cat > "$NGINX_CONF_FILE" <<EOF
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

    location / {
        proxy_pass         ${backend_proxy}/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
EOF
    else
        cat > "$NGINX_CONF_FILE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 20m;

    location / {
        proxy_pass         ${backend_proxy}/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF
    fi

    if [[ "${ENABLE_SSL}" == "true" ]]; then
        if [[ ! -f "${INSTALL_ROOT}/certs/fullchain.pem" ]]; then
            log "Obtaining TLS certificate for ${DOMAIN} via certbot standalone"
            DEBIAN_FRONTEND=noninteractive apt-get install -y certbot

            systemctl stop nginx || true
            docker stop absenlah_nginx 2>/dev/null || true

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

    systemctl stop nginx || true
    systemctl disable nginx || true

    log "Starting docker compose stack"
    cd "$INSTALL_ROOT"
    docker compose --env-file "$ENV_FILE" -f "$DOCKER_COMPOSE_FILE" up -d --build --remove-orphans
    record_state "compose_up"

    ok "Deployment complete — https://${DOMAIN}/ ready"
}

# ============================================================================
#  STEP 5 — Automated Build Pipeline
# ============================================================================
detect_stack() {
    local app_dir="${INSTALL_ROOT}/app"
    if [[ -f "${app_dir}/package.json" ]] || [[ -f "${app_dir}/frontend/package.json" ]]; then
        echo "expo"
    else
        echo "unknown"
    fi
}

step_build_mobile() {
    CURRENT_STEP="build"
    hdr "STEP 5 — Automated Mobile Build"
    init_dirs

    local stack app_dir out_dir
    stack="$(detect_stack)"
    app_dir="${INSTALL_ROOT}/app"
    out_dir="${BUILD_OUTPUT_DIR}/$(date +%Y%m%d-%H%M%S)"
    install -d -m 0755 "$out_dir"

    log "Detected stack: $stack"

    case "$stack" in
        expo)
            build_expo "$app_dir" "$out_dir"
            ;;
        *)
            err "Unable to detect stack. Use --stack expo"
            return 1
            ;;
    esac

    ln -sfn "$out_dir" "${BUILD_OUTPUT_DIR}/latest"
    record_state "build_done"
    ok "Artifacts organized under $out_dir (symlinked as latest)"
}

build_expo() {
    local app_dir="$1" out_dir="$2"

    local fe_dir="${app_dir}/frontend"
    if [[ ! -d "$fe_dir" ]]; then
        fe_dir="$app_dir"
    fi

    cd "$fe_dir"
    log "Berpindah ke direktori: $(pwd)"

    # FIX: Otomatis membersihkan registry Tencent & Generate ulang yarn.lock yang bersih
    log "Memaksa penggunaan Registry Publik untuk menghindari error saat di-build oleh EAS Expo..."
    yarn config set registry https://registry.yarnpkg.com/
    npm config set registry https://registry.npmjs.org/

    log "Menghapus konfigurasi dan lockfile lama..."
    rm -f .npmrc .yarnrc yarn.lock package-lock.json node_modules -rf

    log "Menjalankan install bersih untuk men-generate yarn.lock publik..."
    yarn install

    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        {
            echo "EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL:-https://${DOMAIN}}"
        } > .env.production

        if [[ -n "${EXPO_TOKEN:-}" ]]; then
            export EXPO_TOKEN="${EXPO_TOKEN}"
        fi
    fi

    if [[ -n "${EXPO_TOKEN:-}" ]]; then
        log "EXPO_TOKEN terdeteksi. Memulai Cloud EAS Build (${EXPO_BUILD_FORMAT:-apk})..."
        npx eas-cli build --platform android --profile ${EXPO_BUILD_PROFILE:-preview} --non-interactive --no-wait | tee -a "$LOG_FILE"
        npx eas-cli build:list --limit 5 --json > "${out_dir}/eas-builds.json" 2>>"$LOG_FILE" || true
        echo "EAS builds have been queued. Track them with: eas build:list" > "${out_dir}/README.txt"
        ok "Cloud Build (EAS) submitted. Lihat status di Dashboard Expo Anda."
    else
        log "EXPO_TOKEN KOSONG. Menggunakan jalur kompilasi PURE LOKAL TANPA EXPO EAS..."

        export JAVA_HOME="$JAVA_HOME_DIR"
        export ANDROID_HOME="$ANDROID_HOME"
        export PATH="$PATH:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

        log "Langkah 1: Generate native Android code (npx expo prebuild)..."
        npx expo prebuild --platform android --clean | tee -a "$LOG_FILE"

        log "Langkah 2: Menjalankan kompilasi Gradle secara lokal..."
        if [[ ! -d "android" ]]; then
            err "Folder 'android' tidak ditemukan setelah prebuild. Build lokal gagal."
            return 1
        fi

        cd android
        chmod +x gradlew

        ./gradlew assembleRelease | tee -a "$LOG_FILE" || {
            err "Gradle build gagal. Pastikan memori RAM cukup."
            return 1
        }
        cd ..

        log "Menyalin hasil APK ke direktori output..."
        find android/app/build/outputs/apk/release -name "*.apk" -exec cp {} "$out_dir/" \; 2>/dev/null || true

        ok "Build Bare Lokal (Tanpa Expo EAS) selesai! Hasil APK tersedia di ${out_dir}"
    fi
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
${C_BOLD}${SCRIPT_NAME}${C_RESET} — Absenlah all-in-one deploy script v3.0

  ${C_CYAN}--clean${C_RESET}       Bersihkan & hapus instalasi / docker lama
  ${C_CYAN}--all${C_RESET}         Run every step in sequence
  ${C_CYAN}--prep${C_RESET}        System prep only
  ${C_CYAN}--clone${C_RESET}       Clone repository only
  ${C_CYAN}--configure${C_RESET}   Environment wizard only
  ${C_CYAN}--deploy${C_RESET}      Docker compose + Nginx only
  ${C_CYAN}--build${C_RESET}       Mobile artifact build only
  ${C_CYAN}--rollback${C_RESET}    Manually undo the most recent run
  ${C_CYAN}--help${C_RESET}        Show this message
USAGE
}

parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --clean)      DO_CLEAN=1 ;;
            --all)        DO_PREP=1; DO_CLONE=1; DO_CONFIG=1; DO_DEPLOY=1; DO_BUILD=1 ;;
            --prep)       DO_PREP=1 ;;
            --clone)      DO_CLONE=1 ;;
            --configure)  DO_CONFIG=1 ;;
            --deploy)     DO_DEPLOY=1 ;;
            --build)      DO_BUILD=1 ;;
            --rollback)   DO_ROLLBACK=1 ;;
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
    log "Log file     : $LOG_FILE"

    (( DO_CLEAN   )) && step_clean_installation
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
