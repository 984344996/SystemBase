#!/usr/bin/env pwsh
# ============================================================
# SystemBase 一键部署到远程服务器（Windows PowerShell 版，Mac/Linux 请用 deploy.sh）
# 方式：本机构建 → 打包上传 → 服务器安装依赖/迁移/切换版本/PM2 重启/健康检查（失败自动回滚）
#
# 用法（推荐使用统一入口 .\sb.ps1，本脚本等价于 .\sb.ps1 remote-*；首次可能需要
#       Set-ExecutionPolicy -Scope CurrentUser RemoteSigned）:
#   .\deploy.ps1 <环境> init              首次：初始化服务器（Node20/pnpm/PM2/Nginx/MySQL、建库、站点）并发布
#   .\deploy.ps1 <环境>                   日常发布（一条命令）
#   .\deploy.ps1 <环境> fresh             重置发布：清空远程数据库全部数据后重建（需输入库名确认）
#   .\deploy.ps1 <环境> status            服务状态 / 当前版本 / 健康检查 / 今日错误数
#   .\deploy.ps1 <环境> logs [级别|pm2|follow] [日期]
#   .\deploy.ps1 <环境> releases          已发布版本列表
#   .\deploy.ps1 <环境> rollback [版本号] 回滚到上一版本（或指定版本），数据库不回退
#   .\deploy.ps1 <环境> restart|start|stop
#   .\deploy.ps1 <环境> ssl 域名          部署 HTTPS（Let's Encrypt + 自动续期）
#   .\deploy.ps1 <环境> db-backup [备注]  备份服务器数据库并拉回本地 backup\<环境>\（服务器保留 7 天）
#   .\deploy.ps1 <环境> db-restore <文件>  用本地 backup\<环境>\xxx.sql.gz 恢复服务器数据库（需输入库名确认）
#   .\deploy.ps1 <环境> doctor            环境体检：版本/服务/健康检查/磁盘/错误日志/备份 + 本地与服务器配置差异
#   .\deploy.ps1 <环境> db-remote-on [IP] / db-remote-off [IP]
#   .\deploy.ps1 <环境> ssh               登录服务器
# 环境: remote-<名字>（如 remote-pre 预发布 / remote-release 正式），对应 deploy/envs/<环境>.env
# 前置:
#   1. 复制 deploy/envs/remote.env.example 为 deploy/envs/<环境>.env 并填写 SSH_HOST 与应用配置
#      （所有远程环境共用这一份模板；新增环境复制同一份，环境名只能小写字母、数字、连字符）
#   2. 已配置 SSH 免密登录（见 docs/deploy.md；Windows 不支持 SSH_PASSWORD）
# 可选: -SkipTests 跳过发布前单测；$env:DB_ROOT_PASS='xxx' init 时提供 MySQL root 密码
# ============================================================
param(
  [Parameter(Position = 0)][string]$Environment = "",
  [Parameter(Position = 1)][string]$Command = "deploy",
  [Parameter(Position = 2)][string]$Arg1 = "",
  [Parameter(Position = 3)][string]$Arg2 = "",
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root
$envTool = Join-Path $root "deploy\server\env-tool.cjs"
$utf8NoBom = New-Object Text.UTF8Encoding($false)

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Show-Usage {
  Get-Content $PSCommandPath -Encoding UTF8 | Select-Object -Skip 6 -First 21 | ForEach-Object { $_ -replace '^# ?', '' }
  exit 1
}

# ---------- 读取环境配置（deploy/envs/<环境>.env） ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "需要 Node.js ≥ 20" }
if (-not $Environment -or $Environment -in @("-h", "--help", "help")) { Show-Usage }
$envsFile = Join-Path $root "deploy\envs\$Environment.env"
if (-not (Test-Path $envsFile)) { Fail "缺少 $envsFile（先复制 deploy\envs\remote.env.example 为该文件后填写）" }
function Get-EnvValue([string]$key, [string]$default = "") {
  return [string](& node $envTool get $envsFile $key $default | Select-Object -First 1)
}
$sshHost = Get-EnvValue "SSH_HOST"
if (-not $sshHost -or $sshHost -match "YOUR_") { Fail "请先在 $envsFile 中填写 SSH_HOST" }
$sshPort = Get-EnvValue "SSH_PORT" "22"; if (-not $sshPort) { $sshPort = "22" }
$sshUser = Get-EnvValue "SSH_USER" "root"; if (-not $sshUser) { $sshUser = "root" }
if (Get-EnvValue "SSH_PASSWORD") { Fail "Windows 下不支持 SSH_PASSWORD，请配置 SSH 免密登录（见 docs/deploy.md）" }
$appDir = Get-EnvValue "DEPLOY_DIR" "/opt/systembase"; if (-not $appDir) { $appDir = "/opt/systembase" }
$appName = Get-EnvValue "APP_NAME" "systembase"; if (-not $appName) { $appName = "systembase" }
$keep = Get-EnvValue "KEEP_RELEASES" "5"; if (-not $keep) { $keep = "5" }
$registry = Get-EnvValue "NPM_REGISTRY" "https://registry.npmmirror.com"
# 服务器安装/使用的 pnpm 版本与仓库 packageManager 锁定值保持一致（与 deploy.sh 行为相同；取不到时用服务器脚本内置默认）
$pmSpec = [string](& node -p "require('./package.json').packageManager || ''" | Select-Object -First 1)
$pmVer = "9"
if ($pmSpec -and $pmSpec -like "pnpm@*") { $pmVer = $pmSpec.Substring(6) }
if ($appDir -notmatch '^/[\w./-]+$' -or $appDir -eq "/") { Fail "DEPLOY_DIR 必须是绝对路径，如 /opt/systembase" }
if ($appName -notmatch '^[a-z][a-z0-9-]*$') { Fail "APP_NAME 只能包含小写字母、数字、连字符" }

# 应用配置 = 环境文件剔除部署专用键（每次发布前重新生成到 .run，打包与 init 上传用；产物，gitignore）
$runDir = Join-Path $root ".run"
if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Force -Path $runDir | Out-Null }
$envProd = Join-Path $runDir "env.production"
$deployKeys = '^\s*(SSH_HOST|SSH_PORT|SSH_USER|SSH_PASSWORD|DEPLOY_DIR|APP_NAME|KEEP_RELEASES|NPM_REGISTRY|DB_ROOT_PASS)='
$lines = @(Get-Content $envsFile -Encoding UTF8 | Where-Object { $_ -notmatch $deployKeys })
[IO.File]::WriteAllText($envProd, (($lines -join "`n") + "`n"), $utf8NoBom)

$target = "$sshUser@$($sshHost)"
# accept-new：首次连接新服务器时自动接受主机指纹（非交互下不会卡在确认提示）
$sshOpts = @("-p", $sshPort, "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "StrictHostKeyChecking=accept-new")
$ops = "bash $appDir/current/deploy/server/ops.sh $appDir $appName"
$script:RemoteCode = 0

# 远程执行：输出直接显示；退出码记入 $script:RemoteCode（-NoThrow 时由调用方判断）
function Invoke-Remote([string]$cmd, [switch]$Tty, [switch]$NoThrow) {
  $a = @() + $sshOpts
  if ($Tty) { $a += "-t" } else { $a += @("-o", "BatchMode=yes") }
  $a += @($target, $cmd)
  & ssh @a
  $script:RemoteCode = $LASTEXITCODE
  if ($script:RemoteCode -ne 0 -and -not $NoThrow) { Fail "远程命令执行失败（退出码 $($script:RemoteCode)）" }
}

# 捕获远程命令输出（用于取得服务器上生成的备份文件路径）；不重定向 stderr（PS 5.1 会当异常）
function Invoke-RemoteCapture([string]$cmd) {
  $a = @() + $sshOpts + @("-o", "BatchMode=yes") + @($target, $cmd)
  $out = @(& ssh @a)
  if ($LASTEXITCODE -ne 0) { Fail "远程命令执行失败（退出码 $LASTEXITCODE）" }
  return $out
}

function Send-Files([string[]]$files, [string]$dest) {
  # 与 ssh 保持同样的首次连接策略，避免 scp 卡在主机指纹确认
  $a = @("-P", $sshPort, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", "-q") + $files + @("${target}:$dest")
  & scp @a
  if ($LASTEXITCODE -ne 0) { Fail "上传失败: $($files -join ', ')" }
}

function Test-Ssh {
  Write-Host "检查 SSH 免密登录 $target ..."
  Invoke-Remote "true" -NoThrow
  if ($script:RemoteCode -ne 0) { Fail "无法免密登录 ${target}:$sshPort，请先配置 SSH 密钥（见 docs/deploy.md）" }
}

function Test-EnvProd {
  $null = & node $envTool check $envProd
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Get-SiteUrl {
  # 子路径部署（SITE_PATH=/systembase-pre）时访问地址要带上该前缀，与 deploy.sh 一致
  $p = Get-EnvValue "SITE_PATH" ""
  return (((Get-EnvValue "CORS_ORIGINS" "http://$sshHost") -split ",")[0] + $p)
}

# 转 LF 并以 UTF-8（无 BOM）写回：服务器上 bash 不认 CRLF
function Convert-ToLF([string]$path) {
  $c = [IO.File]::ReadAllText($path) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($path, $c, $utf8NoBom)
}

# vite base：根路径部署 "/"；子路径部署（SITE_PATH=/systembase-pre）为 "/systembase-pre/"（带尾斜杠）
function Get-SiteBasePath {
  $p = Get-EnvValue "SITE_PATH" ""
  if (-not $p) { return "/" }
  if (-not $p.StartsWith("/")) { $p = "/" + $p }
  return ($p.TrimEnd("/") + "/")
}

# ---------- 构建 ----------
function Invoke-Build {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）" }
  $pv = [string](& pnpm -v | Select-Object -First 1)
  if ($pv -notmatch '^9\.') { Fail "需要 pnpm 9.x（当前: $pv）。执行 corepack enable，或 npm i -g pnpm@9" }
  # 始终按 lockfile 同步依赖：node_modules 存在但 lockfile 已变时，避免用旧依赖构建出与服务器不一致的产物
  Write-Step "同步依赖（lockfile 未变化时秒级完成）"
  Invoke-Checked "依赖安装失败" { pnpm install --frozen-lockfile }
  Write-Step "构建共享包 + 生成 Prisma Client"
  Invoke-Checked "共享包构建失败" { pnpm --filter "@sb/shared" build }
  Invoke-Checked "Prisma Client 生成失败" { pnpm --filter "@sb/server" prisma:generate }
  if (-not $SkipTests) {
    Write-Step "后端单元测试（-SkipTests 可跳过）"
    Invoke-Checked "单元测试未通过，已停止发布" { pnpm --filter "@sb/server" test --silent }
  }
  Write-Step "构建后端（nest build）"
  Invoke-Checked "后端构建失败" { pnpm --filter "@sb/server" build }
  Write-Step "构建前端（vue-tsc + vite build）"
  # 子路径部署（SITE_PATH）：vite base / 路由 / API 前缀随构建产物自动适配，与 deploy.sh 一致
  $env:SB_BASE_PATH = Get-SiteBasePath
  try {
    Invoke-Checked "前端构建失败" { pnpm --filter "@sb/web" build }
  } finally {
    Remove-Item Env:SB_BASE_PATH -ErrorAction SilentlyContinue
  }
}

# ---------- 打包：只含运行所需文件，node_modules 在服务器按 lockfile 安装 ----------
function New-ReleaseTar([string]$stamp) {
  $stage = Join-Path $env:TEMP "$appName-stage-$stamp"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  foreach ($d in @("packages\shared", "apps\server", "apps\web", "deploy")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $d) | Out-Null
  }
  Copy-Item "$root\package.json", "$root\pnpm-workspace.yaml", "$root\pnpm-lock.yaml" $stage
  Copy-Item "$root\packages\shared\package.json" "$stage\packages\shared\"
  Copy-Item "$root\packages\shared\dist" "$stage\packages\shared\dist" -Recurse
  Copy-Item "$root\apps\server\package.json" "$stage\apps\server\"
  foreach ($d in @("dist", "prisma")) { Copy-Item "$root\apps\server\$d" "$stage\apps\server\$d" -Recurse }
  Copy-Item "$root\apps\web\package.json" "$stage\apps\web\"
  Copy-Item "$root\apps\web\dist" "$stage\apps\web\dist" -Recurse
  Copy-Item "$root\deploy\server" "$stage\deploy\server" -Recurse
  Get-ChildItem "$stage\deploy\server" -File | ForEach-Object { Convert-ToLF $_.FullName }
  Copy-Item $envProd "$stage\.env.production"
  Convert-ToLF "$stage\.env.production"

  $commit = "none"
  if (Test-Path (Join-Path $root ".git")) { $commit = [string](& git rev-parse --short HEAD | Select-Object -First 1) }
  $version = [string](& node -p "require('./package.json').version")
  $meta = "release=$stamp`nenv=$Environment`nbuiltAt=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`nbuiltBy=$env:USERNAME@$env:COMPUTERNAME`ncommit=$commit`nversion=$version`n"
  [IO.File]::WriteAllText((Join-Path $stage "RELEASE"), $meta, $utf8NoBom)

  $tarPath = Join-Path $root "$appName-$stamp.tar.gz"
  & tar -czf $tarPath -C $stage . | Out-Null   # 函数返回值只能是路径，屏蔽其他输出
  $code = $LASTEXITCODE
  Remove-Item $stage -Recurse -Force
  if ($code -ne 0) { Fail "打包失败（需要 Windows 10 1803+ 自带的 tar）" }
  return $tarPath
}

# ---------- 发布（mode: deploy | fresh） ----------
function Invoke-Deploy([string]$mode = "deploy") {
  Test-EnvProd
  Test-Ssh
  Invoke-Build
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  Write-Step "打包发布文件"
  $tarPath = New-ReleaseTar $stamp
  $tarName = Split-Path $tarPath -Leaf
  Write-Host ("    {0}（{1} MB）" -f $tarName, [math]::Round((Get-Item $tarPath).Length / 1MB, 1))
  try {
    Write-Step "上传到 $target"
    $rscript = "/tmp/$appName-deploy-$stamp.sh"
    $localScript = Join-Path $env:TEMP "$appName-remote-deploy-$stamp.sh"
    Copy-Item "$root\deploy\server\remote-deploy.sh" $localScript
    Convert-ToLF $localScript
    Send-Files @($tarPath) "/tmp/$tarName"
    Send-Files @($localScript) $rscript
    Remove-Item $localScript -Force

    if ($mode -eq "fresh") { Write-Step "服务器执行重置发布" } else { Write-Step "服务器执行发布（依赖/迁移/切换/重启/健康检查）" }
    $cmd = "tr -d '\r' < $rscript > $rscript.lf; NPM_REGISTRY='$registry' PNPM_VERSION='$pmVer' bash $rscript.lf '$appDir' '/tmp/$tarName' '$mode' '$appName' '$keep'; rc=`$?; rm -f $rscript $rscript.lf '/tmp/$tarName'; exit `$rc"
    Invoke-Remote $cmd -NoThrow
    if ($script:RemoteCode -ne 0) { Fail "发布失败（线上仍为原版本或已自动回滚）。排查: .\sb.ps1 $Environment logs pm2" }
  } finally {
    Remove-Item $tarPath -Force -ErrorAction SilentlyContinue
  }

  $url = Get-SiteUrl
  Write-Host "`n===========================================" -ForegroundColor Green
  Write-Host " 发布完成: $stamp（环境: $Environment → $target）" -ForegroundColor Green
  Write-Host " 访问地址: $url/" -ForegroundColor Green
  if ($mode -eq "fresh") { Write-Host " 数据已重置，默认账号 admin / admin123，请立即登录修改密码！" -ForegroundColor Red }
  Write-Host " 查看状态: .\sb.ps1 $Environment status    回滚: .\sb.ps1 $Environment rollback" -ForegroundColor Green
  Write-Host "===========================================" -ForegroundColor Green
}

function Assert-Released {
  Invoke-Remote "test -L $appDir/current" -NoThrow
  if ($script:RemoteCode -ne 0) { Fail "服务器尚未发布过，请先执行 .\deploy.ps1 init" }
}

# ---------- 命令分发 ----------
# 每个命令在服务器上实际发生的动作（与 sb.sh 一致）：
#   deploy   本机构建打包 → 上传 → 装依赖 → migrate deploy → 切软链 → PM2 重启 → 健康检查（失败自动回滚）
#   init     服务器装环境 → 建库建账号 → Nginx 站点 → 放行防火墙 → PM2 自启 → 再执行一次 deploy
#   fresh    服务端 prisma migrate reset 清库后重新发布（需输入库名确认）
#   status   读取服务器 current 版本、PM2/Nginx 状态、磁盘、今日 ERROR/WARN 数、健康检查
#   logs     读服务器当天日志文件（级别/日期/follow/pm2）
#   releases / rollback   列出历史版本 / 切换软链回滚（数据库不回退）
#   restart / start / stop  重启/启动/停止应用（start、stop 连带 Nginx）
#   ssl      申请证书 + 301 跳转 + 自动续期
#   db-remote-on / off     临时开放/关闭数据库远程访问
#   ssh      交互式登录服务器
#   db-backup / db-restore / doctor   调用 deploy\server 下同名脚本（在服务器上执行）
$cmdName = $Command.ToLower()
switch ($cmdName) {
  "deploy" { Invoke-Deploy }

  "init" {
    Test-EnvProd
    Test-Ssh
    Write-Step "1/3 上传生产配置与初始化脚本"
    $setupDir = "/tmp/$appName-setup"
    Invoke-Remote "mkdir -p '$appDir/shared' $setupDir"
    $tmp = Join-Path $env:TEMP "$appName-setup"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item -ItemType Directory -Path $tmp | Out-Null
    foreach ($f in @("setup-server.sh", "env-tool.cjs", "nginx-site.conf")) {
      Copy-Item "$root\deploy\server\$f" $tmp
      Convert-ToLF (Join-Path $tmp $f)
    }
    Copy-Item $envProd (Join-Path $tmp "env.production")
    Convert-ToLF (Join-Path $tmp "env.production")
    Send-Files @((Join-Path $tmp "env.production")) "$appDir/shared/.env"
    Send-Files @((Join-Path $tmp "setup-server.sh"), (Join-Path $tmp "env-tool.cjs"), (Join-Path $tmp "nginx-site.conf")) "$setupDir/"
    Remove-Item $tmp -Recurse -Force

    Write-Step "2/3 初始化服务器（Node20 / pnpm / PM2 / Nginx / MySQL / 建库 / 站点）"
    $rootPass = if ($env:DB_ROOT_PASS) { $env:DB_ROOT_PASS } else { Get-EnvValue "DB_ROOT_PASS" }
    Invoke-Remote "cd $setupDir && DB_ROOT_PASS='$rootPass' NPM_REGISTRY='$registry' PNPM_VERSION='$pmVer' bash setup-server.sh '$appDir' '$appName'; rc=`$?; rm -rf $setupDir; exit `$rc" -Tty

    Write-Step "3/3 首次发布"
    Invoke-Deploy
    Write-Host "首次部署完成：默认账号 admin / admin123，请立即登录修改密码；确认安全组已放行 80/443。" -ForegroundColor Yellow
  }

  "fresh" {
    Test-EnvProd
    $dbName = [string](& node $envTool db $envProd | Select-Object -Index 4)
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Red
    Write-Host "  危险操作：远程数据库将被完全重置" -ForegroundColor Red
    Write-Host "  服务器: $target    数据库: $dbName" -ForegroundColor Red
    Write-Host "  全部业务数据将被删除且不可恢复，账号恢复为默认密码" -ForegroundColor Red
    Write-Host "  （日志文件不受影响）" -ForegroundColor Red
    Write-Host "====================================================" -ForegroundColor Red
    $confirm = Read-Host "请输入数据库名 $dbName 确认"
    if ($confirm -ne $dbName) { Write-Host "已取消，未做任何改动"; return }
    Invoke-Deploy "fresh"
  }

  { $_ -in @("status", "releases", "restart", "start", "stop") } {
    Assert-Released; Invoke-Remote "$ops $cmdName"
  }
  "logs" {
    # 参数会拼进远端命令，先做白名单校验（级别仅字母，日期 YYYY-MM-DD），与 deploy.sh 一致
    if ($Arg1 -and $Arg1 -notin @("pm2", "follow", "-f") -and $Arg1 -notmatch '^[A-Za-z]+$') {
      Fail "日志级别参数只支持字母（ERROR/WARN/INFO/pm2/follow）"
    }
    if ($Arg2 -and $Arg2 -notmatch '^\d{4}-\d{2}-\d{2}$') { Fail "日期格式应为 YYYY-MM-DD" }
    Assert-Released
    if ($Arg1 -in @("follow", "-f")) { Invoke-Remote "$ops logs follow" -Tty -NoThrow }
    else { Invoke-Remote "$ops logs '$Arg1' '$Arg2'" -NoThrow }
  }
  "rollback" {
    if ($Arg1 -and $Arg1 -notmatch '^\d{14}$') { Fail "版本号为 14 位时间戳（.\sb.ps1 $Environment releases 查看）" }
    Assert-Released; Invoke-Remote "$ops rollback '$Arg1'"
  }
  "ssl" {
    if (-not $Arg1) { Fail "用法: .\deploy.ps1 ssl 你的域名" }
    Assert-Released
    Invoke-Remote "bash $appDir/current/deploy/server/setup-ssl.sh '$Arg1' '$appName' '$appDir'"
  }
  "db-remote-on" {
    Assert-Released
    $ip = if ($Arg1) { $Arg1 } else { "%" }
    Invoke-Remote "bash $appDir/current/deploy/server/db-remote.sh '$appDir' on '$ip'" -Tty
  }
  "db-remote-off" {
    Assert-Released
    Invoke-Remote "bash $appDir/current/deploy/server/db-remote.sh '$appDir' off '$Arg1'" -Tty
  }
  # 备份：服务器端 mysqldump → 拉回本地 backup\<环境>\
  "db-backup" {
    Assert-Released; Test-Ssh
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $localDir = Join-Path $root "backup\$Environment"
    if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force -Path $localDir | Out-Null }
    Write-Step "在服务器备份数据库（环境: $Environment）"
    $rscript = "/tmp/$appName-dbbackup-$stamp.sh"
    $localScript = Join-Path $env:TEMP "$appName-dbbackup-$stamp.sh"
    Copy-Item "$root\deploy\server\db-backup.sh" $localScript
    Convert-ToLF $localScript
    Send-Files @($localScript) $rscript
    Remove-Item $localScript -Force
    $lines = @(Invoke-RemoteCapture "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' backup '$Arg1'; rc=`$?; rm -f $rscript $rscript.lf; exit `$rc")
    $remoteFile = ($lines | Where-Object { $_ -match '\.sql\.gz$' } | Select-Object -Last 1)
    if (-not $remoteFile) { Fail "备份失败：未取得服务器上的备份文件（排查: .\sb.ps1 $Environment logs pm2）" }
    $tarName = Split-Path $remoteFile -Leaf
    Write-Step "拉回本地 backup\$Environment\$tarName"
    $a = @("-P", $sshPort, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-q", "${target}:${remoteFile}", (Join-Path $localDir $tarName))
    & scp @a
    if ($LASTEXITCODE -ne 0) { Fail "下载备份失败" }
    Write-Host "✓ 已保存到 backup\$Environment\$tarName" -ForegroundColor Green
  }
  # 恢复：危险操作，需输入库名确认；服务器脚本恢复前会自动先备份当前库
  "db-restore" {
    Assert-Released; Test-Ssh
    $src = $Arg1
    if (-not $src) { Fail "用法: .\sb.ps1 $Environment db-restore backup\$Environment\xxx.sql.gz" }
    if (-not (Test-Path $src)) { Fail "本地备份文件不存在: $src" }
    $dbName = [string](& node $envTool db $envProd | Select-Object -Index 4)
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Red
    Write-Host "  危险操作：服务器数据库将被覆盖" -ForegroundColor Red
    Write-Host "  环境: $Environment    服务器: $target    数据库: $dbName" -ForegroundColor Red
    Write-Host "  来源: $src" -ForegroundColor Red
    Write-Host "====================================================" -ForegroundColor Red
    $confirm = Read-Host "请输入数据库名 $dbName 确认"
    if ($confirm -ne $dbName) { Write-Host "已取消，未做任何改动"; return }
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    Write-Step "上传备份文件并恢复"
    $rfile = "/tmp/$appName-restore-$stamp.sql.gz"
    $rscript = "/tmp/$appName-restore-$stamp.sh"
    $localScript = Join-Path $env:TEMP "$appName-restore-$stamp.sh"
    Copy-Item "$root\deploy\server\db-backup.sh" $localScript
    Convert-ToLF $localScript
    Send-Files @($src) $rfile
    Send-Files @($localScript) $rscript
    Remove-Item $localScript -Force
    Invoke-Remote "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' restore '$rfile'; rc=`$?; rm -f $rscript $rscript.lf $rfile; exit `$rc"
    Write-Host "✓ 恢复完成" -ForegroundColor Green
  }
  # 体检：上传本地应用配置，比对服务器 shared/.env 是否有未同步改动
  "doctor" {
    Assert-Released; Test-Ssh
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    Write-Step "环境体检（$Environment → $target）"
    $expect = "/tmp/$appName-expect-$stamp.env"
    $rscript = "/tmp/$appName-doctor-$stamp.sh"
    $localScript = Join-Path $env:TEMP "$appName-doctor-$stamp.sh"
    Copy-Item "$root\deploy\server\doctor.sh" $localScript
    Convert-ToLF $localScript
    Send-Files @($envProd) $expect
    Send-Files @($localScript) $rscript
    Remove-Item $localScript -Force
    Invoke-Remote "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' '$expect'; rc=`$?; rm -f $rscript $rscript.lf $expect; exit `$rc" -NoThrow
  }
  "ssh" { & ssh @sshOpts $target }
  { $_ -in @("help", "-h", "--help") } { Show-Usage }
  default {
    Write-Host "未知命令: $Command（环境 $Environment。.\deploy.ps1 help 查看用法）"
    exit 1
  }
}
