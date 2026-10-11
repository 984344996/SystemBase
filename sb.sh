#!/usr/bin/env bash
# ============================================================
# SystemBase 统一入口：一套命令操作全部环境（Mac/Linux 版，Windows 请用 sb.ps1）
#
# 环境（配置文件都在 deploy/envs/）:
#   local            本地开发（你的电脑：watch 模式 + 本机数据库），配置 deploy/envs/local.env
#   remote-<名字>    远程环境（SSH 上传发布），配置 deploy/envs/remote-<名字>.env
#                    新增环境: cp deploy/envs/remote.env.example deploy/envs/remote-<名字>.env 后填写
#                    （环境名只能小写字母、数字、连字符；现有: remote-pre 预发布 / remote-release 正式）
#
# 用法:
#   ./sb.sh local [start|fresh|stop|status|logs|db-backup|db-restore|db-list]   本地启动（默认 start）
#   ./sb.sh remote-pre <命令>                        预发布环境操作
#   ./sb.sh remote-release <命令>                     正式环境操作
#
#   远程 <命令>: deploy(默认，发布) | init(首次初始化服务器) | fresh(重置数据) |
#               status | logs | releases | rollback | restart | start | stop |
#               db-backup | db-restore | doctor | ssl 域名 | db-remote-on/off | ssh
#
# ------------------------------------------------------------------
# 每个命令实际会做什么（按顺序）：
#
# 【local】本机开发，不碰服务器
#   start(默认)  ① 装依赖(lockfile 变化时) ② 停掉旧进程 ③ 检查端口没被别的程序占用
#                ④ prisma migrate deploy(补跑未应用的迁移，库不存在会自动建库)
#                ⑤ seed 幂等补齐数据(超管/菜单/权限点/默认任务)
#                ⑥ 后台启动后端(Nest watch) + 前端(Vite) ⑦ 等待健康检查通过
#   fresh        ⚠ 先执行 prisma migrate reset 清空本地库 → 再走一遍 start 的全部流程
#   stop         结束后端与前端进程（只结束本项目目录内的进程，不会误杀别人的）
#   status       查看 后端/前端/MySQL 是否在运行 + /api/health 健康检查结果
#   logs         跟踪 .run/server.log（后端输出）
#   db-backup    用 mysqldump 备份本地库到 backup/local/<时间>_<备注>.sql.gz
#   db-restore   从本地备份文件恢复本地库（需输入库名确认；恢复前自动先备份当前库）
#   db-list      列出本地已有备份
#
# 【remote-pre / remote-release】本机打包 + SSH 到服务器操作
#   init         首次使用：① 在服务器装 Node20/pnpm/PM2/Nginx/(库在本机时)MySQL
#                ② 按 env 里的 DATABASE_URL 建库、建账号并授权
#                ③ 生成 Nginx 站点、放行 80/443、设置 PM2 开机自启
#                ④ 上传应用配置为 shared/.env ⑤ 执行一次完整发布
#                （可重复执行；不会重建数据库）
#   deploy(默认) ① 跑单测 ② 本机构建前后端 ③ 打包(约 0.5MB)上传
#                ④ 服务器按 lockfile 装生产依赖
#                ⑤ 数据库预检（本机 MySQL 未启动时自动拉起）→ prisma migrate deploy 执行未应用的迁移（不删数据）+ seed 补齐数据
#                ⑥ 切换 current 软链到新版本 → PM2 重启
#                ⑦ /api/health 60s 内不通则自动回滚到上一版本
#                ⑧ 发布成功后自动挂回曾被 stop 摘掉的 Nginx 站点配置
#   fresh        ⚠ 清库前自动备份到服务器 shared/backup → prisma migrate reset 清空数据库
#                → 再走一遍 deploy（需输入库名确认）
#   status       服务器上的当前版本 / PM2 状态 / Nginx / 磁盘 / 今日 ERROR·WARN 数 / 健康检查
#   logs         读服务器当天日志（logs ERROR、logs WARN 2026-10-03、logs follow、logs pm2）
#   releases     列出服务器上保留的历史版本（用于回滚）
#   rollback     把 current 软链切回上一版本并重启（秒级；【数据库不会回退】）
#   restart/start/stop   重启 / 启动(含 Nginx) / 停止(含 Nginx，页面下线)
#   db-backup    在服务器执行 mysqldump → scp 拉回本地 backup/<env>/
#   db-restore   把本地备份上传服务器并导入（需输入库名确认；恢复前自动先备份当前库）
#   doctor       体检：版本/服务/健康检查/磁盘/今日错误数/最近备份，并比对
#                「本机 env 的应用配置」与「服务器 shared/.env」的差异（防改了配置忘记发布）
#   ssl 域名     申请 Let's Encrypt 证书 + 配置 301 跳转 + 自动续期
#   db-remote-on/off  临时开放/关闭数据库远程访问（排查用，用完务必关闭）
#   ssh          登录服务器（交互式）
#   gen-crud     生成 CRUD 模块骨架（本机操作，不碰服务器）
#   setup-hooks  启用 .githooks/pre-commit（提交前自动跑 pnpm lint && pnpm test）
#
# 提示：所有远程命令都不会改动数据库结构以外的业务数据，fresh 是唯一的清库操作。
# ------------------------------------------------------------------
#
# 示例:
#   ./sb.sh local start                # 本地一键启动
#   ./sb.sh local db-backup            # 备份本地数据库到 backup/local/
#   ./sb.sh remote-pre init            # 首次初始化预发布服务器并发布
#   ./sb.sh remote-pre deploy          # 发布到预发布
#   ./sb.sh remote-pre status          # 预发布服务状态
#   ./sb.sh remote-pre doctor          # 预发布环境体检（含配置差异比对）
#   ./sb.sh remote-pre db-backup 发版前 # 备份预发布库并拉回本地
#   ./sb.sh remote-release deploy      # 发布到正式
#   ./sb.sh remote-release logs error  # 查看正式环境今日错误日志
#   ./sb.sh remote-release ssh         # 登录正式服务器
#   ./sb.sh setup-hooks                # 启用 pre-commit 钩子（提交前跑 lint + test）
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }

usage() {
  sed -n '5,17p' "$0" | sed 's/^# \{0,1\}//'
  echo ""
  echo -e "${C}各命令的详细执行步骤见: sed -n '19,66p' sb.sh${N}"
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
[ $# -gt 0 ] && shift   # 去掉命令名本身，其余参数原样透传

case "$ENV_NAME" in
  -h|--help|help) usage ;;
  setup-hooks)
    # 启用 .githooks（提交前跑 pnpm lint + pnpm test）；不引入 husky 依赖
    [ -d .git ] || die "当前目录不是 git 仓库"
    chmod +x .githooks/pre-commit
    git config core.hooksPath .githooks
    echo -e "${G}✓ 已启用 pre-commit 钩子（.githooks/pre-commit）${N}"
    echo "  提交前将执行: pnpm lint && pnpm test；临时跳过: SKIP_HOOKS=1 git commit ..."
    ;;
  gen-crud)
    # 非环境命令：CRUD 代码生成器（参数原样透传）
    if [ -n "$CMD" ]; then exec node scripts/gen-crud.mjs "$CMD" "$@"; fi
    exec node scripts/gen-crud.mjs "$@"
    ;;
  local)
    exec bash start-local.sh "${CMD:-restart}" "$@"
    ;;
  remote-*)
    [ -f "deploy/envs/$ENV_NAME.env" ] || die "缺少 deploy/envs/$ENV_NAME.env（先 cp deploy/envs/remote.env.example deploy/envs/$ENV_NAME.env 后填写）"
    exec bash deploy.sh "$ENV_NAME" ${CMD:+$CMD} "$@"
    ;;
  *) die "未知环境: ${ENV_NAME}（可用: local / remote-pre / remote-release；新增远程环境: cp deploy/envs/remote.env.example deploy/envs/remote-<名字>.env，见 ./sb.sh help）" ;;
esac
