#!/bin/bash
# =====================================
# NGINX + HTTPS SETUP (LETS ENCRYPT)
# =====================================

DOMAIN="uniteapps.com"
APP_PORT=8080

echo "================================"
echo "Configurando Nginx para $DOMAIN..."
echo "================================"

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN.conf"

# 1. Config solo HTTP para que certbot pueda funcionar
sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        root /var/www/uniteapps.com;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:$APP_PORT/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. Generar certificado SSL (solo si no existe)
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "Generando certificado SSL con Let's Encrypt..."
  sudo certbot certonly --nginx -d $DOMAIN --non-interactive --agree-tos -m unite@${DOMAIN} || {
    echo " certbot fallo"
  }
else
  echo "Certificado SSL ya existe, renovando si es necesario..."
  sudo certbot renew --non-interactive || true
fi

# 3. Config final con HTTP → HTTPS redirect
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        root /var/www/uniteapps.com;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:$APP_PORT/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
else
  echo "SSL no disponible, queda configurado solo HTTP"
fi

sudo nginx -t && sudo systemctl reload nginx

echo "================================"
echo "Setup completo para $DOMAIN"
echo " Backend: https://${DOMAIN}/api/simulacion/iniciar"
echo "================================"
