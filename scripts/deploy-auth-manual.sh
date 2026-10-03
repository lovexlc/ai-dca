#!/bin/bash
# ai-dca auth 服务手动部署脚本
# 在 CN 主机上以 root 身份运行
#
# 用法:
#   1. 从仓库复制 services/auth 到 /tmp: 
#      (或者 git clone 后复制)
#   2. 设置 INTERNAL_SYNC_TOKEN 环境变量 (与 Worker 侧一致)
#   3. 运行: INTERNAL_SYNC_TOKEN=xxx bash deploy-auth-manual.sh
#
set -euo pipefail

AUTH_DIR="/opt/ai-dca-auth"
AUTH_DATA_DIR="/var/lib/ai-dca-auth"
AUTH_SRC="${1:-./services/auth}"  # auth 服务源码目录

if [ -z "${INTERNAL_SYNC_TOKEN:-}" ]; then
  echo "ERROR: 请设置 INTERNAL_SYNC_TOKEN 环境变量"
  echo "  INTERNAL_SYNC_TOKEN=xxx bash $0 [源码目录]"
  exit 1
fi

if [ ! -d "$AUTH_SRC" ]; then
  echo "ERROR: 源码目录不存在: $AUTH_SRC"
  exit 1
fi

echo "=== 1. 安装 Node.js 22 (如需要) ==="
if ! command -v node >/dev/null || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" 2>/dev/null; then
  echo "正在安装 Node.js 22..."
  NODE_VERSION="v22.14.0"
  ARCH=$(uname -m)
  [ "$ARCH" = "x86_64" ] && NODE_ARCH="x64" || NODE_ARCH="arm64"
  cd /tmp
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o node.tar.xz
  tar -xf node.tar.xz
  cp -a "node-${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" /usr/bin/node
  cp -a "node-${NODE_VERSION}-linux-${NODE_ARCH}/bin/npm" /usr/bin/npm 2>/dev/null || true
  rm -rf node.tar.xz "node-${NODE_VERSION}-linux-${NODE_ARCH}"
fi
echo "Node: $(node --version)"

echo "=== 2. 部署 auth 服务文件 ==="
install -d -m 755 "$AUTH_DIR"
install -d -m 755 "$AUTH_DATA_DIR"
cp -a "$AUTH_SRC/." "$AUTH_DIR/"
cd "$AUTH_DIR"
npm install --production
echo "文件部署完成"

echo "=== 3. 创建 systemd 服务 ==="
cat > /etc/systemd/system/ai-dca-auth.service <<EOF
[Unit]
Description=ai-dca local auth service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$AUTH_DIR
Environment=AUTH_DB_PATH=$AUTH_DATA_DIR/auth.sqlite
Environment=AUTH_PORT=8080
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $AUTH_DIR/src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/ai-dca-auth-sync.service <<EOF
[Unit]
Description=ai-dca auth sync worker
After=network.target ai-dca-auth.service

[Service]
Type=simple
User=root
WorkingDirectory=$AUTH_DIR
Environment=AUTH_DB_PATH=$AUTH_DATA_DIR/auth.sqlite
Environment=SYNC_WORKER_URL=https://api.freebacktrack.tech/api/sync/internal/sync-auth
Environment=INTERNAL_SYNC_TOKEN=$INTERNAL_SYNC_TOKEN
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $AUTH_DIR/src/syncWorker.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 清除变量，避免残留
unset INTERNAL_SYNC_TOKEN

systemctl daemon-reload
systemctl enable ai-dca-auth.service
systemctl enable ai-dca-auth-sync.service
systemctl restart ai-dca-auth.service
systemctl restart ai-dca-auth-sync.service
echo "systemd 服务已启动"

echo "=== 4. 健康检查 ==="
sleep 3
if curl -sf http://127.0.0.1:8080/health; then
  echo ""
  echo "✓ auth 服务运行正常"
else
  echo ""
  echo "✗ 健康检查失败，查看日志:"
  systemctl status ai-dca-auth.service --no-pager | head -20
  exit 1
fi

echo ""
echo "=== 5. 配置 nginx ==="
NGINX_CONF="/etc/nginx/sites-available/ai-dca-cn-5000"
if grep -q "location.*\\/api\\/sync\\/auth\\/" "$NGINX_CONF"; then
  echo "nginx auth 路由已存在，跳过"
else
  python3 <<'PY'
from pathlib import Path
path = Path("/etc/nginx/sites-available/ai-dca-cn-5000")
text = path.read_text()
auth_block = """    location ^~ /api/sync/auth/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

"""
marker = "    location /api/ {"
if marker not in text:
    raise SystemExit("generic /api/ location not found")
text = text.replace(marker, auth_block + marker, 1)
path.write_text(text)
print("nginx 配置已更新")
PY
  nginx -t && nginx -s reload
  echo "✓ nginx 已重载"
fi

echo ""
echo "=== 部署完成 ==="
echo "  - Auth 服务: http://127.0.0.1:8080"
echo "  - 健康检查: curl http://127.0.0.1:8080/health"
echo "  - 查看日志: journalctl -u ai-dca-auth -f"
echo "  - 同步日志: journalctl -u ai-dca-auth-sync -f"
echo ""
echo "下一步: 从 D1 导入现有用户数据 (见 docs/plan-auth-local-sqlite.md)"
