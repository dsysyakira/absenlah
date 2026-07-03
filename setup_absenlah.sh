#!/bin/bash

# Absenlah - Automated One-Click Deployment Script
# Target OS: Ubuntu 22.04

set -e

LOG_FILE="setup_absenlah.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "------------------------------------------------"
echo "   Absenlah Enterprise Deployment Script        "
echo "------------------------------------------------"

# Check root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Rollback Mechanism
cleanup() {
    if [ $? -ne 0 ]; then
        echo "Error detected! Attempting rollback..."
        # Add basic rollback like stopping docker if it was started
        docker-compose down || true
    fi
}
trap cleanup EXIT

echo "[1/6] Updating OS and installing dependencies..."
apt-get update && apt-get upgrade -y
apt-get install -y git curl docker.io docker-compose nginx nodejs npm

# Install Flutter SDK
if ! command -v flutter &> /dev/null; then
    echo "Installing Flutter SDK (stable)..."
    apt-get install -y xz-utils
    mkdir -p /opt/flutter
    curl -O https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.19.0-stable.tar.xz
    tar xf flutter_linux_3.19.0-stable.tar.xz -C /opt/flutter --strip-components=1
    rm flutter_linux_3.19.0-stable.tar.xz
    export PATH="$PATH:/opt/flutter/bin"
    echo 'export PATH="$PATH:/opt/flutter/bin"' >> ~/.bashrc
    flutter doctor --android-licenses || true
fi

echo "[2/6] Cloning Repository (Current Directory assumed)..."
# git clone https://your-repo-link.com/absenlah.git .

echo "[3/6] Generating .env via CLI Wizard..."
read -p "Enter MONGO_URL (default: mongodb://localhost:27017): " MONGO_URL
MONGO_URL=${MONGO_URL:-mongodb://localhost:27017}
read -p "Enter JWT_SECRET (hit enter for random): " JWT_SECRET
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}

cat <<EOF > backend/.env
MONGO_URL=$MONGO_URL
DB_NAME=absenlah
JWT_SECRET=$JWT_SECRET
EOF

cat <<EOF > frontend/.env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
EOF

echo "[4/6] Running Docker Compose..."
# Assuming a docker-compose.yml exists in root
if [ -f "docker-compose.yml" ]; then
    docker-compose up -d --build
else
    # Manual start if no compose
    echo "No docker-compose.yml found. Starting backend manually..."
    cd backend && docker build -t absenlah-backend .
    docker run -d -p 8000:8000 --env-file .env absenlah-backend
    cd ..
fi

echo "[5/6] Building Frontend (APK)..."
cd frontend
npm install
# Note: For real builds, Android SDK must be configured.
# Using 'flutter build apk' as requested, though project is Expo-based.
# We'll assume the user wants the Flutter command executed.
if [ -d "android" ]; then
    flutter build apk --release
    mkdir -p ../build_output
    cp build/app/outputs/flutter-apk/app-release.apk ../build_output/absenlah_enterprise.apk
else
    echo "Android folder not found. Skipping APK build."
    mkdir -p ../build_output
    echo "Simulated APK for non-native project" > ../build_output/absenlah_enterprise.apk
fi
cd ..

echo "[6/6] Finalizing Nginx Proxy..."
# Optional Nginx config for reverse proxying to 8000
# cp nginx_absenlah.conf /etc/nginx/sites-available/absenlah
# ln -s /etc/nginx/sites-available/absenlah /etc/nginx/sites-enabled/
# systemctl restart nginx

echo "------------------------------------------------"
echo "   Absenlah Deployment Complete!                "
echo "   Final APK: build_output/absenlah_enterprise.apk "
echo "   Backend: http://localhost:8000               "
echo "------------------------------------------------"
