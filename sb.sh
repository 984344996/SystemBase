#!/usr/bin/env bash
# ============================================================
# SystemBase 统一入口：一套命令操作全部环境（Mac/Linux 版，Windows 请用 sb.ps1）
#
# 环境（配置文件都在 deploy/envs/，复制 *.env.example 为实际文件后填写）:
#   local            本地开发（你的电脑：watch 模式 + 本机数据库）
#   remote-pre       远程预发布（SSH 上传发布，配置 deploy/envs/remote-pre.env）
#   remote-release   远程正式   （SSH 上传发布，配置 deploy/envs/remote-release.env）
#
# 用法:
#   ./sb.sh local [start|fresh|stop|status|logs]     本地启动（默认 start）
#   ./sb.sh remote-pre <命令>                        预发布环境操作
#   ./sb.sh remote-release <命令>                     正式环境操作
#
#   远程 <命令>: deploy(默认，发布) | init(首次初始化服务器) | fresh(重置数据) |
#               status | logs | releases | rollback | restart | start | stop |
#               ssl 域名 | db-remote-on/off | ssh
#
# 示例:
#   ./sb.sh local start                # 本地一键启动
#   ./sb.sh remote-pre init            # 首次初始化预发布服务器并发布
#   ./sb.sh remote-pre deploy          # 发布到预发布
#   ./sb.sh remote-pre status          # 预发布服务状态
#   ./sb.sh remote-release deploy      # 发布到正式
#   ./sb.sh remote-release logs error  # 查看正式环境今日错误日志
#   ./sb.sh remote-release ssh         # 登录正式服务器
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }

usage() {
  sed -n '5,26p' "$0" | sed 's/^# \{0,1\}//'
  echo ""
  echo -e "${C}已配置的环境（deploy/envs/）:${N}"
  local f name
  for f in deploy/envs/*.env; do
    [ -f "$f" ] || continue
    name="$(basename "$f" .env)"
    case "$name" in
      local)          echo "  local            本地开发" ;;
      remote-pre)     echo "  remote-pre       远程预发布" ;;
      remote-release) echo "  remote-release   远程正式" ;;
      *)              echo "  $name" ;;
    esac
  done
  exit 1
}

ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] || usage
shift
CMD="${1:-}"

case "$ENV_NAME" in
  -h|--help|help) usage ;;
  local)
    exec bash start-local.sh "${CMD:-restart}" "$@"
    ;;
  remote-*)
    [ -f "deploy/envs/$ENV_NAME.env" ] || die "缺少 deploy/envs/$ENV_NAME.env（cp deploy/envs/$ENV_NAME.env.example 后填写）"
    exec bash deploy.sh "$ENV_NAME" ${CMD:+$CMD} "$@"
    ;;
  *) die "未知环境: ${ENV_NAME}（可用: local / remote-pre / remote-release，见 ./sb.sh help）" ;;
esac
