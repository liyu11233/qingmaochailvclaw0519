#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if [ -f ".env" ]; then
  set -a
  source ".env"
  set +a
fi

export PORT="${PORT:-5173}"

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm。请先安装 Node.js 18 或更高版本。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "首次启动：正在安装依赖..."
  npm install
fi

echo "青猫差旅采集工具启动中..."
echo "访问地址：http://localhost:${PORT}"
echo "关闭本窗口即可停止本地服务。"

(sleep 2 && open "http://localhost:${PORT}") >/dev/null 2>&1 &

npm run dev
