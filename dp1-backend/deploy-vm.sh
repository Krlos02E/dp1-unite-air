#!/bin/bash
# =====================================
#  DEPLOY VM PUCP (frontend + SSL)
# =====================================

IMAGE_NAME="dp1-backend"
IMAGE_TAG="v1"

VM_HOST="1inf54-983-1a.inf.pucp.edu.pe"
VM_USER="1inf54.983.1a"
VM_PASS="${V_MACHINE_PASSWORD:?Error: V_MACHINE_PASSWORD no está definida}"
VM_DIR="/home/${VM_USER}/dp1-unite-air"
SSH="sshpass -p ${VM_PASS} ssh -t -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST}"
SUDO="echo ${VM_PASS} | sudo -S"
DOMAIN="1inf54-983-1a.inf.pucp.edu.pe"
APP_PORT=8081
set -e

echo "Building frontend..."
cd "$(dirname "$0")/../dp1-frontend"
npm install
npm run build
cd "$(dirname "$0")/../dp1-backend"

echo "====================================="
echo "[1/7] Uploading source code to VM..."
echo "====================================="
${SSH} "mkdir -p ${VM_DIR}"
sshpass -p "${VM_PASS}" rsync -e "ssh -o StrictHostKeyChecking=no" -avz --delete \
  --exclude='.git' --exclude='.idea' --exclude='target' --exclude='node_modules' \
  --exclude='dp1-frontend' --exclude='*.tar' --exclude='*.tar.gz' \
  --exclude='AGENT.MD' --exclude='AGENTS.md' --exclude='README.md' \
  --exclude='docker-compose.yml' --exclude='.gitmodules' --exclude='.dockerignore' \
  --exclude='ssh-config.txt' --exclude='limpiar-ssh.sh' --exclude='subir-tar.sh' \
  --exclude='dp1-backend/deploy.sh' --exclude='dp1-backend/deploy.bat' \
  $(dirname "$0")/../ ${VM_USER}@${VM_HOST}:${VM_DIR}/

echo "====================================="
echo "[2/7] Uploading frontend dist..."
echo "====================================="
sshpass -p "${VM_PASS}" ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST} "sudo mkdir -p /var/www/${DOMAIN}"
sshpass -p "${VM_PASS}" rsync -e "ssh -o StrictHostKeyChecking=no" -avz --delete \
  "$(dirname "$0")/../dp1-frontend/dist/" \
  ${VM_USER}@${VM_HOST}:/var/www/${DOMAIN}/

echo "====================================="
echo "[3/7] Building Docker image on VM..."
echo "====================================="
${SSH} "cd ${VM_DIR} && ${SUDO} docker build -t ${IMAGE_NAME}:${IMAGE_TAG} -f dp1-backend/Dockerfile ."

echo "====================================="
echo "[4/7] Setting up MySQL..."
echo "====================================="
${SSH} "${SUDO} docker network create unite-air-net 2>/dev/null || true; \
   if ! ${SUDO} docker ps -a --format '{{.Names}}' | grep -q '^unite-air-mysql$'; then
     ${SUDO} docker run -d --name unite-air-mysql --network unite-air-net --restart unless-stopped \
       -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=unite_air -v mysql_data:/var/lib/mysql mysql:8.0
   fi"

echo "====================================="
echo "[5/7] Replacing backend container..."
echo "====================================="
${SSH} "${SUDO} docker rm -f ${IMAGE_NAME} || true"
${SSH} "${SUDO} docker run -d \
    -p ${APP_PORT}:8080 \
    --name ${IMAGE_NAME} \
    --network unite-air-net \
    -e SPRING_DATASOURCE_URL='jdbc:mysql://unite-air-mysql:3306/unite_air?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC' \
    -e SPRING_DATASOURCE_USERNAME=root \
    -e SPRING_DATASOURCE_PASSWORD=root \
    -e SERVER_SERVLET_CONTEXT_PATH=/api \
    ${IMAGE_NAME}:${IMAGE_TAG}"

echo "====================================="
echo "[6/7] Configuring Nginx (frontend + API)..."
echo "====================================="
cat > /tmp/nginx-${DOMAIN}.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        root /var/www/${DOMAIN};
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:${APP_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
    }
}
EOF
sshpass -p "${VM_PASS}" scp -o StrictHostKeyChecking=no /tmp/nginx-${DOMAIN}.conf ${VM_USER}@${VM_HOST}:/tmp/nginx-${DOMAIN}.conf
sshpass -p "${VM_PASS}" ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST} "echo ${VM_PASS} | sudo -S cp /tmp/nginx-${DOMAIN}.conf /etc/nginx/sites-available/${DOMAIN}.conf && echo ${VM_PASS} | sudo -S ln -sf /etc/nginx/sites-available/${DOMAIN}.conf /etc/nginx/sites-enabled/ && echo ${VM_PASS} | sudo -S nginx -t && echo ${VM_PASS} | sudo -S systemctl reload nginx"
rm -f /tmp/nginx-${DOMAIN}.conf

echo "====================================="
echo "[7/7] SSL certificate (Certbot)..."
echo "====================================="
echo "Instalando certbot si no está..."
sshpass -p "${VM_PASS}" ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST} "echo ${VM_PASS} | sudo -S apt install -y certbot python3-certbot-nginx 2>/dev/null || true"
echo "Generando certificado SSL..."
sshpass -p "${VM_PASS}" ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST} "echo ${VM_PASS} | sudo -S certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m admin@${DOMAIN} || echo 'certbot fallo, puedes ejecutarlo manualmente'"

# Si certbot generó certificados, reemplazar config con HTTPS
sshpass -p "${VM_PASS}" ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST} "if [ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; then echo 'SSL ok' ; else echo 'Sin SSL' ; fi"

echo ""
echo "====================================="
echo " DEPLOY COMPLETED"
echo " Frontend: https://${DOMAIN}"
echo " Backend:  https://${DOMAIN}/api/simulacion/iniciar"
echo "====================================="
