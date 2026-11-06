#!/usr/bin/env pwsh
# ============================================================
# SystemBase 一键部署到远程服务器（Windows PowerShell 版，Mac/Linux 请用 deploy.sh；两者行为一致）
# 方式：本机构建 → 打包上传 → 服务器后台执行发布（装依赖/备份/迁移/切换版本/PM2 重启/健康检查，失败自动回滚）
#
# 用法（推荐用统一入口 .\sb.ps1，本脚本等价于 .\sb.ps1 remote-*；首次可能需要
#       Set-ExecutionPolicy -Scope CurrentUser RemoteSigned）:
#   .\deploy.ps1 <环境> init              首次：初始化服务器（Node20/pnpm/PM2/Nginx/MySQL、建库、站点）并发布
#   .\deploy.ps1 <环境>                   日常发布（一条命令）
#   .\deploy.ps1 <环境> fresh             重置发布：清空远程数据库全部数据后重建（需输入库名确认）
#   .\deploy.ps1 <环境> deploy-log [版本号] 查看最近一次（或指定版本）发布的完整输出；进行中则持续跟踪
#   .\deploy.ps1 <环境> status            服务状态 / 当前版本 / 健康检查 / 今日错误数
#   .\deploy.ps1 <环境> logs [级别|pm2|follow] [日期]
#   .\deploy.ps1 <环境> releases          已发布版本列表
#   .\deploy.ps1 <环境> rollback [版本号] 回滚到上一版本（或指定版本）：代码 + 配置 + Nginx，数据库不回退
#   .\deploy.ps1 <环境> restart|start|stop  重启 / 启动 / 停止（stop 后页面显示维护中）
#   .\deploy.ps1 <环境> migrate-status    查看数据库迁移状态
#   .\deploy.ps1 <环境> migrate-resolve <applied|rolled-back> <迁移名>
#   .\deploy.ps1 <环境> ssl 域名          部署 HTTPS（Let's Encrypt + 自动续期；子路径部署不适用）
#   .\deploy.ps1 <环境> db-backup [备注]  备份服务器数据库并拉回本地 backup\<环境>\（服务器保留 7 天）
#   .\deploy.ps1 <环境> db-restore <文件>  用本地 backup\<环境>\xxx.sql.gz 恢复服务器数据库（需输入库名确认）
#   .\deploy.ps1 <环境> doctor            环境体检 + 本地与服务器配置差异
#   .\deploy.ps1 <环境> db-remote-on [IP] / db-remote-off [IP]
#   .\deploy.ps1 <环境> ssh               登录服务器
# 环境: remote-<名字>（如 remote-pre 预发布 / remote-release 正式），对应 deploy/envs/<环境>.env
# 前置:
#   1. 复制 deploy/envs/remote.env.example 为 deploy/envs/<环境>.env 并填写 SSH_HOST 与应用配置
#   2. 已配置 SSH 免密登录（见 docs/deploy.md；Windows 不支持 SSH_PASSWORD）
# 可选: -SkipTests 跳过发布前单测（正式环境不允许）；环境变量（$env:XXX='1'）含义同 deploy.sh：
#   DB_ROOT_PASS / SKIP_DB_BACKUP / FORCE_FRESH / ALLOW_FRESH / CONFIRM=<环境名> / FORCE
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

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }   # 步骤标题
function Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }        # 打印错误并退出

# 打印顶部注释里的用法说明（第 3 行到注释块结束）
function Show-Usage {
  $lines = Get-Content $PSCommandPath -Encoding UTF8
  for ($i = 2; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^# ={10}') { break }
    $lines[$i] -replace '^# ?', ''
  }
  exit 1
}

# 外部命令失败（退出码非 0）即中止
function Invoke-Checked([string]$errMsg, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { Fail $errMsg }
}

# ============================================================
# 一、读取环境配置（deploy/envs/<环境>.env）
# ============================================================
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "需要 Node.js ≥ 20" }
if (-not $Environment -or $Environment -in @("-h", "--help", "help")) { Show-Usage }
$envsFile = Join-Path $root "deploy\envs\$Environment.env"
if (-not (Test-Path $envsFile)) { Fail "缺少 $envsFile（先复制 deploy\envs\remote.env.example 为该文件后填写）" }

# 读取 env 文件中的变量
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
# 服务器安装/使用的 pnpm 版本与仓库 packageManager 锁定值保持一致
$pmSpec = [string](& node -p "require('./package.json').packageManager || ''" | Select-Object -First 1)
$pmVer = "9"
if ($pmSpec -and $pmSpec -like "pnpm@*") { $pmVer = $pmSpec.Substring(6) }
# 部署目录与应用名会拼进远程命令：只允许安全字符
if ($appDir -notmatch '^/[\w./-]+$' -or $appDir -eq "/") { Fail "DEPLOY_DIR 必须是绝对路径且只含字母数字 . _ - /，如 /opt/systembase" }
if ($appName -notmatch '^[a-z][a-z0-9-]*$') { Fail "APP_NAME 只能包含小写字母、数字、连字符" }

# 正式环境标记：PROTECTED=true/1 → 是；false/0 → 否；未配置时环境名为 remote-release 视为正式
$protectedVal = (Get-EnvValue "PROTECTED" "").ToLower()
$isProtected = if ($protectedVal -in @("1", "true", "yes")) { $true } elseif ($protectedVal -in @("0", "false", "no")) { $false } else { $Environment -eq "remote-release" }

$target = "$sshUser@$($sshHost)"
# accept-new：首次连接新服务器时自动接受主机指纹（非交互下不会卡在确认提示）
$sshOpts = @("-p", $sshPort, "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "StrictHostKeyChecking=accept-new")
$scpOpts = @("-P", $sshPort, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", "-q")
$ops = "bash $appDir/current/deploy/server/ops.sh $appDir $appName"   # 服务器运维命令前缀
$script:RemoteCode = 0
$script:TarPath = ""
$script:LocalLock = ""

# ============================================================
# 二、应用配置文件（每次执行独立的临时文件，退出时删除）
# ============================================================
# 应用配置 = 环境文件剔除部署专用键（上传为服务器 shared/.env）
# ⚠ 新增部署段变量时必须加进 $deployKeys（deploy.sh 的 DEPLOY_KEYS 同步），否则会被上传到服务器
$runDir = Join-Path $root ".run"
if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Force -Path $runDir | Out-Null }
Remove-Item (Join-Path $runDir "env.production") -Force -ErrorAction SilentlyContinue   # 旧版本脚本的固定文件名
# 清理异常退出遗留的临时配置（超过 1 天的）
Get-ChildItem $runDir -Filter "env.*.*" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force -ErrorAction SilentlyContinue
$envProd = Join-Path $runDir ("env.$Environment." + [guid]::NewGuid().ToString("N").Substring(0, 8))
$deployKeys = '^\s*(export\s+)?(SSH_HOST|SSH_PORT|SSH_USER|SSH_PASSWORD|DEPLOY_DIR|APP_NAME|KEEP_RELEASES|NPM_REGISTRY|DB_ROOT_PASS|PROTECTED)\s*='
$lines = @(Get-Content $envsFile -Encoding UTF8 | Where-Object { $_ -notmatch $deployKeys })
[IO.File]::WriteAllText($envProd, (($lines -join "`n") + "`n"), $utf8NoBom)

# 退出时统一清理：临时配置、本地发布包、本机构建锁
function Clear-Local {
  Remove-Item $envProd -Force -ErrorAction SilentlyContinue
  if ($script:TarPath) { Remove-Item $script:TarPath -Force -ErrorAction SilentlyContinue }
  if ($script:LocalLock) { Remove-Item $script:LocalLock -Recurse -Force -ErrorAction SilentlyContinue }
}

# ============================================================
# 三、SSH 执行
# ============================================================

# 远程执行：输出直接显示；退出码记入 $script:RemoteCode（-NoThrow 时由调用方判断）
#   注意：PowerShell 5.1 传给 ssh 的参数里不能含双引号（会被拆坏），远程命令一律只用单引号
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
  if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Write-Host $_ }; Fail "远程命令执行失败（退出码 $LASTEXITCODE）" }
  return $out
}

# 上传文件到服务器
function Send-Files([string[]]$files, [string]$dest) {
  $a = $scpOpts + $files + @("${target}:$dest")
  & scp @a
  if ($LASTEXITCODE -ne 0) { Fail "上传失败: $($files -join ', ')" }
}

# 上传一个服务器脚本：复制到临时目录转 LF 后上传（服务器 bash 不认 CRLF）
function Send-Script([string]$name, [string]$dest) {
  $tmp = Join-Path $env:TEMP ("$appName-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + "-$name")
  Copy-Item "$root\deploy\server\$name" $tmp
  Convert-ToLF $tmp
  try { Send-Files @($tmp) $dest } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# 检查能否免密登录服务器
function Test-Ssh {
  Write-Host "检查 SSH 免密登录 $target ..."
  Invoke-Remote "true" -NoThrow
  if ($script:RemoteCode -ne 0) { Fail "无法免密登录 ${target}:$sshPort，请先配置 SSH 密钥（见 docs/deploy.md）" }
}

# 校验应用配置（NODE_ENV / 数据库密码 / JWT_SECRET / CORS_ORIGINS / PORT）
function Test-EnvProd {
  $null = & node $envTool check $envProd
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

# 服务器上必须已发布过（current 软链存在）
function Assert-Released {
  Invoke-Remote "test -L $appDir/current" -NoThrow
  if ($script:RemoteCode -ne 0) { Fail "服务器尚未发布过，请先执行 .\sb.ps1 $Environment init" }
}

# 发布完成后提示的访问地址：CORS_ORIGINS 第一个地址 + SITE_PATH
function Get-SiteUrl {
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

# ============================================================
# 四、本机防护
# ============================================================

# 本机构建锁：同一工作目录同时只允许一个构建/发布（dist 只有一份，并发会把两个环境的产物串在一起）
function Lock-Build {
  if ($script:LocalLock) { return }
  $lock = Join-Path $runDir "build.lock"
  if (Test-Path $lock) {
    $old = Get-Content (Join-Path $lock "pid") -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($old -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue)) { Fail "本机已有另一个发布正在构建（PID $old），请等它结束后再发布" }
    Remove-Item $lock -Recurse -Force
  }
  New-Item -ItemType Directory -Path $lock | Out-Null
  Set-Content (Join-Path $lock "pid") $PID
  $script:LocalLock = $lock
}

# 当前 commit；有未提交的已跟踪改动时追加 -dirty（写入 RELEASE，便于追溯线上代码）
function Get-GitCommit {
  if (-not (Test-Path (Join-Path $root ".git"))) { return "none" }
  $c = [string](& git rev-parse --short HEAD | Select-Object -First 1)
  if (@(& git status --porcelain --untracked-files=no).Count -gt 0) { $c = "$c-dirty" }
  return $c
}

# 正式环境要求输入环境名确认（$env:CONFIRM=<环境名> 可跳过；非交互且未设置时拒绝）
function Confirm-Env([string]$action) {
  if (-not $isProtected) { return }
  if ($env:CONFIRM -eq $Environment) { return }
  if ([Console]::IsInputRedirected) { Fail "非交互执行正式环境操作，需设置 `$env:CONFIRM='$Environment'" }
  Write-Host "即将对【正式环境 $Environment】执行：$action（服务器 $target）" -ForegroundColor Yellow
  $c = Read-Host "请输入环境名 $Environment 确认"
  if ($c -ne $Environment) { Write-Host "已取消，未做任何改动"; exit 0 }
}

# 正式环境发布检查：工作区干净、main/master 分支、不跳过测试（$env:FORCE='1' 可跳过），然后确认
function Assert-ReleaseGuard([string]$action) {
  if (-not $isProtected) { return }
  if ($env:FORCE -eq "1") {
    Write-Host "!! FORCE=1：跳过正式环境发布检查" -ForegroundColor Yellow
  } else {
    if (-not (Test-Path (Join-Path $root ".git"))) { Fail "正式环境要求在 git 仓库中发布（`$env:FORCE='1' 可跳过）" }
    if (@(& git status --porcelain --untracked-files=no).Count -gt 0) { Fail "正式环境要求工作区干净：有未提交的改动（`$env:FORCE='1' 可跳过）" }
    $br = [string](& git rev-parse --abbrev-ref HEAD | Select-Object -First 1)
    if ($br -notin @("main", "master")) { Fail "正式环境只能从 main/master 发布（当前分支 $br；`$env:FORCE='1' 可跳过）" }
    if ($SkipTests) { Fail "正式环境不允许 -SkipTests（`$env:FORCE='1' 可跳过）" }
  }
  Confirm-Env $action
}

# ============================================================
# 五、构建 / 打包
# ============================================================

# 本机构建：依赖 → 共享包 → Prisma Client → 单测 → 后端 → 前端
function Invoke-Build {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）" }
  $pv = [string](& pnpm -v | Select-Object -First 1)
  if ($pv -notmatch '^9\.') { Fail "需要 pnpm 9.x（当前: $pv）。执行 corepack enable，或 npm i -g pnpm@9" }
  # 始终按 lockfile 同步依赖：避免用旧依赖构建出与服务器不一致的产物
  Write-Step "同步依赖（lockfile 未变化时秒级完成）"
  Invoke-Checked "依赖安装失败" { pnpm install --frozen-lockfile }
  Write-Step "构建共享包 + 生成 Prisma Client"
  Invoke-Checked "共享包构建失败" { pnpm --filter "@sb/shared" build }
  Invoke-Checked "Prisma Client 生成失败" { pnpm --filter "@sb/server" prisma:generate }
  if (-not $SkipTests) {
    Write-Step "后端单元测试（-SkipTests 可跳过）"
    Invoke-Checked "单元测试未通过，已停止发布" { pnpm --filter "@sb/server" test --silent }
  } else {
    Write-Host "!! -SkipTests：已跳过单元测试" -ForegroundColor Yellow
  }
  Write-Step "构建后端（nest build）"
  Invoke-Checked "后端构建失败" { pnpm --filter "@sb/server" build }
  Write-Step "构建前端（vue-tsc + vite build）"
  # 子路径部署（SITE_PATH）：vite base / 路由 / API 前缀随构建产物自动适配
  $env:SB_BASE_PATH = Get-SiteBasePath
  try {
    Invoke-Checked "前端构建失败" { pnpm --filter "@sb/web" build }
  } finally {
    Remove-Item Env:SB_BASE_PATH -ErrorAction SilentlyContinue
  }
}

# 打包：只含运行所需文件（node_modules 在服务器按 lockfile 安装），返回发布包路径
function New-ReleaseTar([string]$stamp) {
  $stage = Join-Path $env:TEMP "$appName-stage-$stamp"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  foreach ($d in @("packages\shared", "apps\server", "apps\web", "deploy")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $d) | Out-Null
  }
  try {
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
    # 版本信息：服务器健康检查据 release 确认新进程已启动；commit 带 -dirty 表示含未提交改动
    $version = [string](& node -p "require('./package.json').version")
    $meta = "release=$stamp`nenv=$Environment`nbuiltAt=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`nbuiltBy=$env:USERNAME@$env:COMPUTERNAME`ncommit=$(Get-GitCommit)`nversion=$version`n"
    [IO.File]::WriteAllText((Join-Path $stage "RELEASE"), $meta, $utf8NoBom)

    $tarPath = Join-Path $root "$appName-$stamp.tar.gz"
    & tar -czf $tarPath -C $stage . | Out-Null   # 函数返回值只能是路径，屏蔽其他输出
    if ($LASTEXITCODE -ne 0) { Fail "打包失败（需要 Windows 10 1803+ 自带的 tar）" }
  } finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
  return $tarPath
}

# 校验发布包：关键文件缺一个都不上传（防止构建产物缺失时把残缺包发上线）
function Test-ReleaseTar([string]$tarPath) {
  $listing = @(& tar -tzf $tarPath)
  if ($LASTEXITCODE -ne 0) { Fail "发布包损坏，无法读取: $tarPath" }
  foreach ($f in @("apps/server/dist/main.js", "apps/server/dist/database/seed.js", "apps/server/prisma/schema.prisma",
      "apps/web/dist/index.html", "deploy/server/remote-deploy.sh", ".env.production", "RELEASE")) {
    if ($listing -notcontains "./$f") { Fail "发布包不完整：缺少 $f（检查构建输出与磁盘空间后重试）" }
  }
  if (-not ($listing | Where-Object { $_ -like "./apps/server/prisma/migrations/*" })) { Fail "发布包不完整：缺少 apps/server/prisma/migrations" }
}

# ============================================================
# 六、服务器端后台发布 + 跟踪
# ============================================================

# 在服务器后台启动发布（setsid + nohup：脱离 SSH 会话，断网也不会中断）
#   输出 shared/deploy-logs/<版本号>.log 及 .pid（进程号）/ .rc（退出码）
function Start-RemoteDeploy([string]$mode, [string]$stamp, [string]$tarName, [string]$rs) {
  $log = "$appDir/shared/deploy-logs/$stamp.log"
  $skipBackup = if ($env:SKIP_DB_BACKUP -eq "1") { "1" } else { "0" }
  $forceFresh = if ($env:FORCE_FRESH -eq "1") { "1" } else { "0" }
  # 只把最后一条命令放到后台（前面的准备步骤失败要立即报错）；输出全部重定向，ssh 才能立即返回
  $cmd = "mkdir -p '$appDir/shared/deploy-logs' && tr -d '\r' < '$rs' > '$rs.lf' && rm -f '$rs' || exit 1; cd /tmp; " +
    "SB_PID_FILE='$log.pid' SB_RC_FILE='$log.rc' SB_CLEANUP='$rs.lf' NPM_REGISTRY='$registry' PNPM_VERSION='$pmVer' " +
    "SKIP_DB_BACKUP='$skipBackup' FORCE_FRESH='$forceFresh' " +
    "`$(command -v setsid || true) nohup bash '$rs.lf' '$appDir' '/tmp/$tarName' '$mode' '$appName' '$keep' > '$log' 2>&1 < /dev/null &"
  # Out-Host：远程输出直接显示，不混进函数返回值
  Invoke-Remote $cmd | Out-Host
  return $log
}

# 跟踪服务器上的发布日志直到发布进程结束；返回发布脚本退出码
#   $logPath = 日志路径或 latest；特殊退出码：98 没有日志 / 99 进程异常退出 / 255 SSH 断开
#   （远程命令里不用双引号：日志路径不含空格，变量为空时用 ${X:-默认值} 兜底）
function Invoke-FollowLog([string]$logPath) {
  if ($logPath -eq "latest") { $sel = "L=`$(ls -1t $appDir/shared/deploy-logs/*.log 2>/dev/null | head -n 1)" } else { $sel = "L=$logPath" }
  $tpl = @'
__SEL__; test -f ${L:-/nonexistent} || { echo deploy log not found; exit 98; }; echo deploy log: $L; for i in $(seq 1 40); do test -s $L.pid && break; sleep 0.25; done; P=$(cat $L.pid 2>/dev/null); if [ ${P:-none} != none ] && kill -0 $P 2>/dev/null; then tail -n +1 -f --pid=$P $L; else cat $L; fi; R=$(cat $L.rc 2>/dev/null); exit ${R:-99}
'@
  # Out-Host：日志逐行实时显示，不混进函数返回值（返回值只有退出码）
  Invoke-Remote ($tpl.Trim().Replace("__SEL__", $sel)) -NoThrow | Out-Host
  return $script:RemoteCode
}

# 发布（mode: deploy | fresh）：校验 → 构建 → 打包校验 → 上传 → 服务器后台执行 → 跟踪结果
function Invoke-Deploy([string]$mode = "deploy") {
  Test-EnvProd
  Test-Ssh
  Lock-Build
  Invoke-Build
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  Write-Step "打包发布文件（环境: $Environment）"
  $script:TarPath = New-ReleaseTar $stamp
  Test-ReleaseTar $script:TarPath
  $tarName = Split-Path $script:TarPath -Leaf
  Write-Host ("    {0}（{1} MB）" -f $tarName, [math]::Round((Get-Item $script:TarPath).Length / 1MB, 1))

  Write-Step "上传到 $target"
  $rscript = "/tmp/$appName-deploy-$stamp.sh"
  Send-Files @($script:TarPath) "/tmp/$tarName"
  Send-Script "remote-deploy.sh" $rscript

  if ($mode -eq "fresh") { Write-Step "服务器执行重置发布（后台运行）" } else { Write-Step "服务器执行发布（后台运行：依赖/备份/迁移/切换/重启/健康检查）" }
  $log = Start-RemoteDeploy $mode $stamp $tarName $rscript
  Write-Host "    Ctrl-C 只停止查看，不会中断服务器上的发布；之后可用 .\sb.ps1 $Environment deploy-log 继续查看" -ForegroundColor Yellow
  $rc = Invoke-FollowLog $log
  switch ($rc) {
    0 { }
    255 { Fail "与服务器的连接中断，发布仍在服务器继续执行。查看进度与结果: .\sb.ps1 $Environment deploy-log" }
    99 { Fail "无法取得发布结果（发布进程异常退出）。查看日志: .\sb.ps1 $Environment deploy-log" }
    default { Fail "发布失败（线上仍为原版本或已自动回滚，原因见上方输出）。完整日志: .\sb.ps1 $Environment deploy-log" }
  }

  $url = Get-SiteUrl
  Write-Host "`n===========================================" -ForegroundColor Green
  Write-Host " 发布完成: $stamp（环境: $Environment → $target）" -ForegroundColor Green
  Write-Host " 访问地址: $url/" -ForegroundColor Green
  if ($mode -eq "fresh") { Write-Host " 数据已重置：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），首次登录需修改密码" -ForegroundColor Red }
  Write-Host " 查看状态: .\sb.ps1 $Environment status    回滚: .\sb.ps1 $Environment rollback" -ForegroundColor Green
  Write-Host "===========================================" -ForegroundColor Green
}

# ============================================================
# 七、命令分发（finally 保证无论成败都清理临时配置 / 发布包 / 构建锁）
# ============================================================
$cmdName = $Command.ToLower()
try {
  switch ($cmdName) {
    # ---------- 日常发布 ----------
    "deploy" {
      Assert-ReleaseGuard "发布"
      Invoke-Deploy
    }

    # ---------- 首次初始化：装环境 → 建库建账号 → Nginx 站点 → 防火墙 → PM2 自启 → 发布 ----------
    "init" {
      Assert-ReleaseGuard "init（初始化服务器并发布）"
      Test-EnvProd
      Test-Ssh
      Lock-Build
      Write-Step "1/3 上传生产配置与初始化脚本"
      $setupDir = "/tmp/$appName-setup"
      Invoke-Remote "mkdir -p '$appDir/shared' && rm -rf '$setupDir' && mkdir -m 700 '$setupDir'"
      $tmp = Join-Path $env:TEMP ("$appName-setup-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
      New-Item -ItemType Directory -Path $tmp | Out-Null
      try {
        $files = @("setup-server.sh", "env-tool.cjs", "nginx-setup.sh", "nginx-site.conf", "nginx-locations.conf")
        foreach ($f in $files) {
          Copy-Item "$root\deploy\server\$f" $tmp
          Convert-ToLF (Join-Path $tmp $f)
        }
        Copy-Item $envProd (Join-Path $tmp "env.production")
        Convert-ToLF (Join-Path $tmp "env.production")
        Send-Files @((Join-Path $tmp "env.production")) "$appDir/shared/.env"
        Send-Files @($files | ForEach-Object { Join-Path $tmp $_ }) "$setupDir/"
        # MySQL root 密码以文件上传（不拼进远程命令行，避免出现在进程列表里）
        $rootPass = if ($env:DB_ROOT_PASS) { $env:DB_ROOT_PASS } else { Get-EnvValue "DB_ROOT_PASS" }
        if ($rootPass) {
          $pwFile = Join-Path $tmp "db-root-pass"
          [IO.File]::WriteAllText($pwFile, $rootPass, $utf8NoBom)
          Send-Files @($pwFile) "$setupDir/db-root-pass"
        }
      } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
      }

      Write-Step "2/3 初始化服务器（Node20 / pnpm / PM2 / Nginx / MySQL / 建库 / 站点）"
      Invoke-Remote "cd $setupDir && NPM_REGISTRY='$registry' PNPM_VERSION='$pmVer' bash setup-server.sh '$appDir' '$appName'; rc=`$?; rm -rf $setupDir; exit `$rc" -Tty -NoThrow
      if ($script:RemoteCode -ne 0) { Fail "服务器初始化失败（见上方输出）。修正后可直接重新执行 init（幂等）" }

      Write-Step "3/3 首次发布"
      Invoke-Deploy
      Write-Host "首次部署完成：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），首次登录需修改密码；确认安全组已放行 80/443。" -ForegroundColor Yellow
    }

    # ---------- 重置发布：清空数据库后重建 ----------
    "fresh" {
      Test-EnvProd
      if ($isProtected -and $env:ALLOW_FRESH -ne "1") { Fail "正式环境禁止 fresh（会清空全部业务数据）。确需执行请设置 `$env:ALLOW_FRESH='1'" }
      $dbName = [string](& node $envTool db $envProd | Select-Object -Index 4)
      Write-Host ""
      Write-Host "====================================================" -ForegroundColor Red
      Write-Host "  危险操作：远程数据库将被完全重置" -ForegroundColor Red
      Write-Host "  环境: $Environment    服务器: $target    数据库: $dbName" -ForegroundColor Red
      Write-Host "  全部业务数据将被删除（清库前服务器会自动备份），账号恢复为默认密码" -ForegroundColor Red
      Write-Host "  （日志文件不受影响）" -ForegroundColor Red
      Write-Host "====================================================" -ForegroundColor Red
      $confirm = Read-Host "请输入数据库名 $dbName 确认"
      if ($confirm -ne $dbName) { Write-Host "已取消，未做任何改动"; return }
      Assert-ReleaseGuard "fresh（清空数据库并重新发布）"
      Invoke-Deploy "fresh"
    }

    # ---------- 查看发布日志 ----------
    "deploy-log" {
      if ($Arg1 -and $Arg1 -notmatch '^\d{14}$') { Fail "版本号为 14 位时间戳（.\sb.ps1 $Environment releases 查看）" }
      Test-Ssh
      $logArg = if ($Arg1) { "$appDir/shared/deploy-logs/$Arg1.log" } else { "latest" }
      $rc = Invoke-FollowLog $logArg
      switch ($rc) {
        0 { Write-Host "✓ 该次发布成功" -ForegroundColor Green }
        98 { exit 1 }
        99 { Write-Host "结果未知：发布进程异常退出（未写入退出码）" -ForegroundColor Yellow; exit 1 }
        255 { Fail "与服务器的连接中断" }
        default { Write-Host "✗ 该次发布失败（退出码 $rc）" -ForegroundColor Red; exit 1 }
      }
    }

    # ---------- 服务器运维（ops.sh） ----------
    { $_ -in @("status", "releases", "restart", "start") } {
      Assert-Released; Invoke-Remote "$ops $cmdName"
    }
    "stop" {
      Assert-Released; Confirm-Env "stop（页面下线为维护中）"; Invoke-Remote "$ops stop"
    }
    "logs" {
      # 参数会拼进远端命令，先做白名单校验（级别仅字母，日期 YYYY-MM-DD）
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
      Assert-Released; Confirm-Env "rollback $Arg1"; Invoke-Remote "$ops rollback '$Arg1'"
    }
    "migrate-status" {
      Assert-Released; Invoke-Remote "$ops migrate-status" -NoThrow
    }
    "migrate-resolve" {
      if ($Arg1 -notin @("applied", "rolled-back")) { Fail "用法: .\sb.ps1 $Environment migrate-resolve <applied|rolled-back> <迁移名>" }
      if ($Arg2 -notmatch '^\d{14}_[A-Za-z0-9_]+$') { Fail "迁移名格式应为 <14位时间戳>_<名称>（.\sb.ps1 $Environment migrate-status 查看）" }
      Assert-Released; Confirm-Env "migrate-resolve $Arg1 $Arg2"; Invoke-Remote "$ops migrate-resolve '$Arg1' '$Arg2'"
    }

    # ---------- HTTPS / 数据库远程访问 ----------
    "ssl" {
      if (-not $Arg1) { Fail "用法: .\sb.ps1 $Environment ssl 你的域名" }
      if ($Arg1 -notmatch '^[A-Za-z0-9.-]+$') { Fail "域名格式不正确: $Arg1" }
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

    # ---------- 备份：服务器端 mysqldump → 拉回本地 backup\<环境>\ ----------
    "db-backup" {
      Assert-Released; Test-Ssh
      $stamp = Get-Date -Format "yyyyMMddHHmmss"
      $localDir = Join-Path $root "backup\$Environment"
      if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force -Path $localDir | Out-Null }
      Write-Step "在服务器备份数据库（环境: $Environment）"
      $rscript = "/tmp/$appName-dbbackup-$stamp.sh"
      Send-Script "db-backup.sh" $rscript
      $out = @(Invoke-RemoteCapture "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' backup '$Arg1'; rc=`$?; rm -f $rscript $rscript.lf; exit `$rc")
      $out | Where-Object { $_ -notmatch '^BACKUP_FILE=' } | ForEach-Object { Write-Host $_ }
      # 脚本最后一行固定输出 BACKUP_FILE=<路径>
      $marker = $out | Where-Object { $_ -match '^BACKUP_FILE=' } | Select-Object -Last 1
      if (-not $marker) { Fail "备份失败：未取得服务器上的备份文件路径" }
      $remoteFile = $marker.Substring("BACKUP_FILE=".Length)
      $fileName = Split-Path $remoteFile -Leaf
      Write-Step "拉回本地 backup\$Environment\$fileName"
      $a = $scpOpts + @("${target}:${remoteFile}", (Join-Path $localDir $fileName))
      & scp @a
      if ($LASTEXITCODE -ne 0) { Fail "下载备份失败" }
      Write-Host "✓ 已保存到 backup\$Environment\$fileName" -ForegroundColor Green
    }

    # ---------- 恢复：危险操作，需输入库名确认；服务器先备份当前库 → 停应用 → 清表 → 导入 → 迁移 → 启动 ----------
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
      Write-Host "  恢复期间应用暂停服务；库内现有表会被全部删除后导入（恢复前自动先备份当前库）" -ForegroundColor Red
      Write-Host "====================================================" -ForegroundColor Red
      $confirm = Read-Host "请输入数据库名 $dbName 确认"
      if ($confirm -ne $dbName) { Write-Host "已取消，未做任何改动"; return }
      $stamp = Get-Date -Format "yyyyMMddHHmmss"
      Write-Step "上传备份文件并恢复"
      $ext = if ($src -like "*.sql") { ".sql" } else { ".sql.gz" }
      $rfile = "/tmp/$appName-restore-$stamp$ext"
      $rscript = "/tmp/$appName-restore-$stamp.sh"
      Send-Files @($src) $rfile
      Send-Script "db-backup.sh" $rscript
      Invoke-Remote "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' restore '$rfile'; rc=`$?; rm -f $rscript $rscript.lf $rfile; exit `$rc" -NoThrow
      if ($script:RemoteCode -ne 0) { Fail "恢复失败（见上方输出）" }
      Write-Host "✓ 恢复完成" -ForegroundColor Green
    }

    # ---------- 体检：上传本地应用配置，比对服务器 shared/.env 是否有未同步改动 ----------
    "doctor" {
      Assert-Released; Test-Ssh
      $stamp = Get-Date -Format "yyyyMMddHHmmss"
      Write-Step "环境体检（$Environment → $target）"
      $expect = "/tmp/$appName-expect-$stamp.env"
      $rscript = "/tmp/$appName-doctor-$stamp.sh"
      Send-Files @($envProd) $expect
      Send-Script "doctor.sh" $rscript
      Invoke-Remote "tr -d '\r' < $rscript > $rscript.lf; bash $rscript.lf '$appDir' '$appName' '$expect'; rc=`$?; rm -f $rscript $rscript.lf $expect; exit `$rc" -NoThrow
    }

    # ---------- 交互式登录服务器 ----------
    "ssh" { & ssh @sshOpts $target }
    { $_ -in @("help", "-h", "--help") } { Show-Usage }
    default {
      Write-Host "未知命令: $Command（环境 $Environment。.\deploy.ps1 help 查看用法）"
      exit 1
    }
  }
} finally {
  Clear-Local
}
