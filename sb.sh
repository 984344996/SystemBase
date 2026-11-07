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
#   远程 <命令>: deploy(默认，发布) | init(首次初始化服务器) | fresh(重置数据) | deploy-log |
#               status | logs | releases | rollback | restart | start | stop |
#               migrate-status | migrate-resolve | db-backup | db-restore | doctor |
#               ssl 域名 | db-remote-on/off | ssh
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
#   deploy(默认) ① 跑单测 ② 本机构建前后端 ③ 打包并校验关键文件 → 上传（约 0.5MB）
#                ④ 服务器后台执行（断网/合上笔记本不会中断；Ctrl-C 只停止查看）：
#                   按 lockfile 装生产依赖 → 数据库预检（本机 MySQL 未启动时自动拉起）
#                   → 有待执行迁移时先自动备份 → prisma migrate deploy（不删数据）→ seed 补齐数据
#                ⑤ 切换 current 软链到新版本 → PM2 重启
#                ⑥ /api/health 60s 内未通过（或版本号不对）则自动回滚：代码 + 配置 + Nginx
#                ⑦ 刷新 Nginx 站点、恢复曾被 stop 的站点、探测前端入口、安装每日备份定时任务
#                正式环境（remote-release）额外要求：工作区干净、main/master 分支、不跳过测试、输入环境名确认
#   fresh        ⚠ 清库前自动备份（失败即中止）→ prisma migrate reset 清空数据库
#                → 再走一遍 deploy（需输入库名确认；正式环境另需 ALLOW_FRESH=1）
#   deploy-log   查看最近一次（或指定版本）发布的完整输出；发布进行中则持续跟踪
#   status       服务器上的当前版本 / PM2 状态 / Nginx / 磁盘 / 今日 ERROR·WARN 数 / 健康检查
#   logs         读服务器当天日志（logs ERROR、logs WARN 2026-10-03、logs follow、logs pm2）
#   releases     列出服务器上保留的历史版本（用于回滚）
#   rollback     把 current 切回上一版本 + 恢复该版本的配置快照 + 重建 Nginx 路由（秒级；【数据库不会回退】）
#   restart/start/stop   重启 / 启动 / 停止（stop：页面换成「维护中」，只影响本环境）
#   migrate-status       查看数据库迁移状态（待执行 / 执行失败的迁移）
#   migrate-resolve      迁移失败（P3009）人工处理后标记：migrate-resolve applied|rolled-back <迁移名>
#   db-backup    在服务器执行 mysqldump → scp 拉回本地 backup/<env>/
#   db-restore   把本地备份上传服务器并导入（需输入库名确认；先备份当前库 → 停应用 → 清表 → 导入
#                → 迁移到当前代码版本 → 启动应用）
#   doctor       体检：版本/服务/健康检查/磁盘/今日错误数/最近发布/备份，并比对
#                「本机 env 的应用配置」与「服务器 shared/.env」的差异（防改了配置忘记发布）
#   ssl 域名     申请 Let's Encrypt 证书 + 配置 301 跳转 + 自动续期（子路径部署不适用）
#   db-remote-on/off  临时开放/关闭数据库远程访问（排查用，用完务必关闭）
#   ssh          登录服务器（交互式）
#   gen-crud     生成 CRUD 模块骨架（本机操作，不碰服务器）
#   init-project 新项目初始化：替换项目名/包作用域/库名，可删除示例模块（先预览，加 --yes 执行）
#   setup-hooks  启用 .githooks/pre-commit（提交前自动跑 pnpm lint && pnpm test）
#
# 可选环境变量（远程命令）：SKIP_TESTS=1 / SKIP_DB_BACKUP=1 / FORCE_FRESH=1 / ALLOW_FRESH=1 /
#   CONFIRM=<环境名> / FORCE=1 / DB_ROOT_PASS=xxx，含义见 deploy.sh 顶部注释
# 提示：所有远程命令都不会改动数据库结构以外的业务数据，fresh / db-restore 是仅有的覆盖数据操作。
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
die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }   # 打印错误并退出

# 用法：打印顶部注释中「环境 / 用法」两段（到第一条 ---- 分隔线为止），再列出已配置的环境
usage() {
  awk 'NR>4 { if (/^# -{10}/) exit; print }' "$0" | sed 's/^# \{0,1\}//'
  echo -e "${C}各命令的详细执行步骤见 sb.sh 顶部注释「每个命令实际会做什么」${N}"
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
  init-project)
    # 非环境命令：新项目初始化（参数原样透传，见 scripts/init-project.mjs）
    if [ -n "$CMD" ]; then exec node scripts/init-project.mjs "$CMD" "$@"; fi
    exec node scripts/init-project.mjs "$@"
    ;;
  gen-crud)
    # 非环境命令：CRUD 代码生成器（参数原样透传）
    if [ -n "$CMD" ]; then exec node scripts/gen-crud.mjs "$CMD" "$@"; fi
    exec node scripts/gen-crud.mjs "$@"
    ;;
  local)
    # 本地开发：交给 start-local.sh（默认 restart = 停旧进程后重新启动）
    exec bash start-local.sh "${CMD:-restart}" "$@"
    ;;
  remote-*)
    # 远程环境：确认 env 文件存在后交给 deploy.sh（命令为空时 deploy.sh 默认执行 deploy）
    [ -f "deploy/envs/$ENV_NAME.env" ] || die "缺少 deploy/envs/$ENV_NAME.env（先 cp deploy/envs/remote.env.example deploy/envs/$ENV_NAME.env 后填写）"
    exec bash deploy.sh "$ENV_NAME" ${CMD:+$CMD} "$@"
    ;;
  *) die "未知环境: ${ENV_NAME}（可用: local / remote-pre / remote-release；新增远程环境: cp deploy/envs/remote.env.example deploy/envs/remote-<名字>.env，见 ./sb.sh help）" ;;
esac
