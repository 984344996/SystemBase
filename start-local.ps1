# ============================================================
# SystemBase 本地一键启动（Windows PowerShell 版，Mac/Linux 请用 start-local.sh）
# 统一入口: .\sb.ps1 local <命令>（本脚本等价于 .\sb.ps1 local）
# 用法（在项目根目录执行）:
#   powershell -ExecutionPolicy Bypass -File start-local.ps1           启动/重启前后端（保留数据）
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 restart   同上
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 fresh     完全重置：清空本地库 → 全部迁移 → 种子数据 → 启动
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 stop      停止前后端
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 status    查看运行状态
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 logs      跟踪前后端开发进程输出
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 db-backup 备份本地数据库到 backup\local\
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 db-restore 文件  恢复本地库（需输入库名确认）
#   powershell -ExecutionPolicy Bypass -File start-local.ps1 db-list   列出本地备份
#
# 说明:
#   - 唯一配置源是 deploy\envs\local.env（端口/数据库等，含 WEB_PORT 前端端口）
#     Mac/Linux 下 apps\server\.env 是指向它的软链接；Windows 每次启动自动复制同步（请只编辑前者）
#   - 数据库连接取 DATABASE_URL，仅允许本机库（localhost/127.0.0.1）
#   - 表结构统一走 prisma migrate（与生产一致），首次运行自动创建数据库；不依赖 mysql.exe
#   - 应用日志写 apps/server/logs/app.YYYY-MM-DD.log；进程输出写 .run/server.log、.run/web.log
# ============================================================
param(
  [Parameter(Position = 0)][string]$Command = "restart",
  [Parameter(Position = 1)][string]$Arg1 = ""
)
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
Set-Location $root
$server = Join-Path $root "apps\server"
$envFile = Join-Path $server ".env"
$localEnv = Join-Path $root "deploy\envs\local.env"
$envTool = Join-Path $root "deploy\server\env-tool.cjs"
$runDir = Join-Path $root ".run"
$serverLog = Join-Path $runDir "server.log"
$webLog = Join-Path $runDir "web.log"

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "!! $msg" -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# 原生命令失败即终止（不要对原生命令重定向 stderr：PS 5.1 会当作异常抛出）
function Invoke-Checked([string]$errMsg, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { Fail $errMsg }
}

# ---------- 前置检查 ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "需要 Node.js ≥ 20" }
$envsDir = Join-Path $root "deploy\envs"
if (-not (Test-Path $envsDir)) { New-Item -ItemType Directory -Force -Path $envsDir | Out-Null }
if (Test-Path $localEnv) {
  # 单一配置源：deploy/envs/local.env → 同步为 Nest 读取的 apps/server/.env
  Copy-Item $localEnv $envFile -Force
} elseif (Test-Path $envFile) {
  # 老项目迁移：现有 apps/server/.env → deploy/envs/local.env（此后请编辑 local.env）
  Copy-Item $envFile $localEnv
  if (-not (Select-String -Path $localEnv -Pattern '^\s*WEB_PORT=' -Quiet)) {
    Add-Content $localEnv "`n# 前端开发端口（Vite；临时覆盖可用 `$env:SB_WEB_PORT='xxxx' 后启动）`nWEB_PORT=5173"
  }
  Copy-Item $localEnv $envFile -Force
  Write-Step "已将 apps\server\.env 迁移为 deploy\envs\local.env（今后请编辑该文件）"
} else {
  Copy-Item (Join-Path $root "deploy\envs\local.env.example") $localEnv
  Add-Content $localEnv "`n# 前端开发端口（Vite；临时覆盖可用 `$env:SB_WEB_PORT='xxxx' 后启动）`nWEB_PORT=5173"
  Copy-Item $localEnv $envFile -Force
  Write-Warn2 "已从模板生成 deploy\envs\local.env，请确认其中 DATABASE_URL 的账号密码后重新执行"
  exit 1
}
$dbInfo = @(& node $envTool db $envFile)
if ($LASTEXITCODE -ne 0) { exit 1 }
$dbHost = $dbInfo[0]; $dbPort = $dbInfo[1]; $dbUser = $dbInfo[2]; $dbPass = $dbInfo[3]; $dbName = $dbInfo[4]
$backupDir = Join-Path $root "backup\local"
if ($dbHost -notin @("localhost", "127.0.0.1")) { Fail "DATABASE_URL 指向 $dbHost，本地脚本只操作本机数据库" }
$serverPort = [int](& node $envTool get $envFile PORT 3000 | Select-Object -First 1)
$webPort = if ($env:SB_WEB_PORT) { [int]$env:SB_WEB_PORT } else { [int](& node $envTool get $envFile WEB_PORT 5173 | Select-Object -First 1) }

# ---------- 工具 ----------
function Test-TcpPort([string]$h, [int]$p) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($h, $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000) -and $tcp.Connected
    $tcp.Close(); return $ok
  } catch { return $false }
}

function Get-PortPids([int]$port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
  } catch { return @() }
}

# 只认命令行包含本项目路径的进程：端口可能被别的项目占用，不能误杀
function Test-OurProcess([int]$procId) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
    return [bool]($p.CommandLine -and $p.CommandLine.ToLower().Contains($root.ToLower()))
  } catch { return $false }
}
function Get-ProcessDesc([int]$procId) {
  try { return (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine } catch { return "PID $procId" }
}

function Assert-PortsFree {
  $busy = $false
  foreach ($port in @($serverPort, $webPort)) {
    foreach ($procId in (Get-PortPids $port)) {
      if (-not (Test-OurProcess $procId)) {
        Write-Warn2 "端口 $port 被其他程序占用: PID $procId（$(Get-ProcessDesc $procId)）"
        $busy = $true
      }
    }
  }
  if ($busy) { Fail "请先停止占用端口的程序后重试（本脚本不会结束非本项目的进程）" }
}

function Assert-Tools {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）" }
  $pv = [string](& pnpm -v | Select-Object -First 1)
  if ($pv -notmatch '^9\.') { Fail "需要 pnpm 9.x（当前: $pv）。执行 corepack enable，或 npm i -g pnpm@9" }
}

function Wait-Mysql {
  if (Test-TcpPort $dbHost $dbPort) { return }
  Write-Step "等待 MySQL 就绪（${dbHost}:$dbPort）..."
  for ($i = 0; $i -lt 15; $i++) {
    if (Test-TcpPort $dbHost $dbPort) { return }
    Start-Sleep -Seconds 1
  }
  Fail "MySQL 未运行。请先启动本地 MySQL 服务（管理员 PowerShell: net start mysql80 或 net start mysql）后重试"
}

function Install-Deps {
  $marker = Join-Path $root "node_modules\.modules.yaml"
  $lock = Join-Path $root "pnpm-lock.yaml"
  if (-not (Test-Path $marker) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $marker).LastWriteTime) {
    Write-Step "安装依赖（pnpm install）..."
    Invoke-Checked "依赖安装失败" { pnpm install --frozen-lockfile }
  }
  Write-Step "构建共享包 + 生成 Prisma Client..."
  Invoke-Checked "共享包构建失败" { pnpm --filter "@sb/shared" build | Out-Null }
  Invoke-Checked "Prisma Client 生成失败（若提示文件被占用，请先 stop 再试）" { pnpm --filter "@sb/server" prisma:generate | Out-Null }
}

# ---------- 停止 ----------
function Stop-Services {
  Write-Step "停止本地服务..."
  $stopped = $false
  foreach ($name in @("server", "web")) {
    $pidFile = Join-Path $runDir "$name.pid"
    if (Test-Path $pidFile) {
      $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($savedPid -match '^\d+$') {
        # /T 结束整棵进程树（cmd → pnpm → nest/vite → node）
        cmd /c "taskkill /PID $savedPid /T /F >nul 2>nul" | Out-Null
        $stopped = $true
      }
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($port in @($serverPort, $webPort)) {
    foreach ($procId in (Get-PortPids $port)) {
      if (Test-OurProcess $procId) {
        cmd /c "taskkill /PID $procId /T /F >nul 2>nul" | Out-Null
        $stopped = $true
      }
    }
  }
  Start-Sleep -Milliseconds 800
  if ($stopped) { Write-Host "  已停止" } else { Write-Host "  （本来就没在运行）" }
}

# ---------- 数据库 ----------
function Invoke-Prisma([string[]]$prismaArgs, [string]$errMsg) {
  Push-Location $server
  try { Invoke-Checked $errMsg { pnpm exec prisma @prismaArgs } } finally { Pop-Location }
}

function Invoke-Seed {
  Write-Step "补齐种子数据（幂等）..."
  Invoke-Checked "种子数据初始化失败" { pnpm --filter "@sb/server" prisma:seed }
}

function Update-Database {
  Write-Step "数据库迁移（prisma migrate deploy：只执行未应用的迁移，库不存在会自动创建）..."
  Invoke-Prisma @("migrate", "deploy") "数据库迁移失败（请确认 MySQL 已启动、账号有建库权限）"
  Invoke-Seed
}

function Reset-Database {
  Write-Warn2 "[fresh] 清空本地数据库 $dbName 并重新执行全部迁移（数据不可恢复）..."
  Invoke-Prisma @("migrate", "reset", "--force", "--skip-seed", "--skip-generate") "数据库重置失败"
  Invoke-Seed
}

# ---------- 启动 ----------
function Start-Services {
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  Write-Step "启动后端（Nest :${serverPort}，watch 模式）→ .run\server.log"
  $ps = Start-Process cmd -ArgumentList "/c cd /d `"$root`" && pnpm --filter @sb/server dev > `"$serverLog`" 2>&1" -WindowStyle Hidden -PassThru
  $ps.Id | Out-File (Join-Path $runDir "server.pid") -Encoding ascii
  # SERVER_PORT：vite 开发代理指向的后端端口（vite.config.ts 读取），与 .env 的 PORT 保持一致
  $env:SERVER_PORT = "$serverPort"
  Write-Step "启动前端（Vite :${webPort}，代理 → :${serverPort}）→ .run\web.log"
  $pw = Start-Process cmd -ArgumentList "/c cd /d `"$root`" && pnpm --filter @sb/web dev --port $webPort --strictPort > `"$webLog`" 2>&1" -WindowStyle Hidden -PassThru
  $pw.Id | Out-File (Join-Path $runDir "web.pid") -Encoding ascii
}

# 任意 HTTP 状态码即视为已响应
function Wait-Http([string]$url, [string]$name, [string]$log, [int]$timeoutSec) {
  Write-Step "等待${name}就绪..."
  for ($i = 0; $i -lt $timeoutSec; $i++) {
    $ok = $false
    try { $null = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing; $ok = $true }
    catch { if ($_.Exception.Response) { $ok = $true } }
    if ($ok) { Write-Host "  ${name}已就绪" -ForegroundColor Green; return }
    Start-Sleep -Seconds 1
  }
  Write-Warn2 "$name ${timeoutSec}s 内未响应，请查看 $log"
  if (Test-Path $log) { Get-Content $log -Tail 15 -Encoding UTF8 }
}

function Show-Summary {
  Write-Host ""
  Write-Host "===========================================" -ForegroundColor Cyan
  Write-Host " 前端:    http://localhost:$webPort"
  Write-Host " 后端API: http://localhost:$serverPort/api（前端已配代理）"
  Write-Host " 账号:    admin / admin123（超级管理员）"
  Write-Host " 应用日志: apps\server\logs\app.$(Get-Date -Format 'yyyy-MM-dd').log"
  Write-Host " 进程输出: .\sb.ps1 local logs"
  Write-Host " 停止:    .\sb.ps1 local stop"
  Write-Host " 配置文件: deploy\envs\local.env"
  Write-Host "===========================================" -ForegroundColor Cyan
}

function Show-Status {
  foreach ($it in @(@{ Name = "后端(Nest)"; Port = $serverPort }, @{ Name = "前端(Vite)"; Port = $webPort })) {
    $all = @(Get-PortPids $it.Port)
    $ours = @($all | Where-Object { Test-OurProcess $_ })
    if ($ours.Count -gt 0) { Write-Host "● $($it.Name) 运行中（:$($it.Port)，PID $($ours -join ' ')）" -ForegroundColor Green }
    else {
      Write-Host "○ $($it.Name) 未运行（:$($it.Port)）" -ForegroundColor Red
      foreach ($procId in $all) { Write-Host "    端口被其他程序占用: PID $procId（$(Get-ProcessDesc $procId)）" -ForegroundColor Yellow }
    }
  }
  if (Test-TcpPort $dbHost $dbPort) { Write-Host "● MySQL 运行中（${dbHost}:$dbPort，库 $dbName）" -ForegroundColor Green }
  else { Write-Host "○ MySQL 未运行（${dbHost}:$dbPort）" -ForegroundColor Red }
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$serverPort/api/health" -TimeoutSec 2 -UseBasicParsing
    Write-Host "● 健康检查正常（HTTP $($r.StatusCode)）" -ForegroundColor Green
  } catch { Write-Host "○ 健康检查未通过" -ForegroundColor Red }
}

function Start-All([string]$mode) {
  Assert-Tools
  Wait-Mysql
  Stop-Services      # 先停：Windows 下运行中的进程会锁住 Prisma 引擎文件，导致 generate 失败
  Assert-PortsFree
  Install-Deps
  if ($mode -eq "fresh") { Reset-Database } else { Update-Database }
  Start-Services
  Wait-Http "http://localhost:$serverPort/api/health" "后端" $serverLog 90
  Wait-Http "http://localhost:$webPort/" "前端" $webLog 30
  Show-Summary
}

# ---------- 数据库备份 / 恢复（Windows 无 gzip，备份为 .sql） ----------
function Get-BackupName([string]$note = "") {
  $name = "${dbName}_$(Get-Date -Format 'yyyyMMddHHmmss')"
  if ($note) { $name = "${name}_$note" }
  return $name
}

# ★ MySQL 8 默认开启 GTID：默认导出的 dump 含 SET @@GLOBAL.GTID_PURGED，恢复时报 ERROR 3546
function Get-GtidDumpOpt {
  $mode = [string](& mysql -h $dbHost -P $dbPort -u $dbUser -N -e "SELECT @@gtid_mode" 2>$null | Select-Object -First 1)
  if ($mode -match '^(ON|ON_PERMISSIVE)$') { return "--set-gtid-purged=OFF" }
  return ""
}

function Invoke-DbBackup([string]$note = "") {
  if (-not (Get-Command mysqldump -ErrorAction SilentlyContinue)) { Fail "未找到 mysqldump（请安装 MySQL 客户端并加入 PATH）" }
  if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
  $out = Join-Path $backupDir "$(Get-BackupName $note).sql"
  # --no-tablespaces：MySQL 8 的 mysqldump 默认读 tablespace 信息（需 PROCESS 权限），非 root 账号会失败
  $gtidOpt = Get-GtidDumpOpt
  # 用 cmd /c 重定向：PowerShell 5.1 重定向默认 UTF-16，会导致备份文件损坏
  $env:MYSQL_PWD = $dbPass
  & cmd /c "mysqldump -h $dbHost -P $dbPort -u $dbUser --default-character-set=utf8mb4 $gtidOpt --no-tablespaces --single-transaction --quick --routines --triggers $dbName > `"$out`""
  $code = $LASTEXITCODE
  $env:MYSQL_PWD = ""
  if ($code -ne 0 -or -not (Test-Path $out)) { Remove-Item $out -Force -ErrorAction SilentlyContinue; Fail "备份失败（确认 MySQL 已启动、账号有 SELECT 权限）" }
  Write-Step "备份完成: backup\local\$(Split-Path $out -Leaf)（$([math]::Round((Get-Item $out).Length / 1KB, 1)) KB）"
  # 清理过期备份
  $keep = if ($env:KEEP_BACKUP_DAYS) { [int]$env:KEEP_BACKUP_DAYS } else { 7 }
  Get-ChildItem $backupDir -Filter "*.sql" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keep) } | ForEach-Object { Remove-Item $_.FullName -Force }
}

function Invoke-DbRestore([string]$src) {
  if (-not $src) { Fail "用法: .\sb.ps1 local db-restore backup\local\xxx.sql" }
  if (-not (Get-Command mysql -ErrorAction SilentlyContinue)) { Fail "未找到 mysql 客户端（无法恢复）" }
  if (-not (Test-Path $src)) {
    $candidate = Join-Path $backupDir $src
    if (Test-Path $candidate) { $src = $candidate } else { Fail "备份文件不存在: $src（.\sb.ps1 local db-list 查看）" }
  }
  Write-Host "将用 $src 覆盖本地数据库 $dbName 的全部数据" -ForegroundColor Red
  $confirm = Read-Host "请输入数据库名 $dbName 确认"
  if ($confirm -ne $dbName) { Write-Host "已取消"; return }
  if (Get-Command mysqldump -ErrorAction SilentlyContinue) { Write-Step "恢复前先备份当前库..."; Invoke-DbBackup "auto-before-restore" }
  # 兼容历史备份：剔除 GTID 语句（否则恢复报 ERROR 3546），写到临时文件再导入
  $gtidPat = '^SET @@(GLOBAL\.GTID_PURGED|SESSION\.SQL_LOG_BIN|SESSION\.GTID_NEXT)'
  $tmp = Join-Path $env:TEMP "sb-restore-$([guid]::NewGuid().ToString('N')).sql"
  $lines = @(Get-Content $src -Encoding UTF8 | Where-Object { $_ -notmatch $gtidPat })
  [IO.File]::WriteAllLines($tmp, $lines, (New-Object Text.UTF8Encoding($false)))
  $env:MYSQL_PWD = $dbPass
  & cmd /c "mysql -h $dbHost -P $dbPort -u $dbUser --default-character-set=utf8mb4 $dbName < `"$tmp`""
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $code = $LASTEXITCODE
  $env:MYSQL_PWD = ""
  if ($code -ne 0) { Fail "恢复失败（退出码 $code）" }
  Write-Step "恢复完成"
}

function Show-BackupList {
  if (-not (Test-Path $backupDir)) { Write-Host "还没有备份"; return }
  Write-Host "本地备份（$backupDir）："
  Get-ChildItem $backupDir -Filter "*.sql" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime |
    ForEach-Object { Write-Host ("  {0} KB`t{1}" -f [math]::Round($_.Length / 1KB, 1), $_.Name) }
  if (-not (Get-ChildItem $backupDir -Filter "*.sql" -File -ErrorAction SilentlyContinue)) { Write-Host "  （空）" }
}

# ---------- 命令分发 ----------
# 每个命令实际会做什么：
#   start / restart(默认)  装依赖 → 停旧进程 → 检查端口 → prisma migrate deploy(库不存在自动建)
#                          → seed 幂等补齐数据 → 后台启动后端+前端 → 等待健康检查
#   fresh                  prisma migrate reset 清空本地库 → 再走一遍 start（需输入 yes）
#   stop                   结束后端与前端（只结束命令行含本项目路径的进程）
#   status                 显示 后端/前端/MySQL 运行状态 + 健康检查
#   logs                   跟踪 .run\server.log（后端 watch 输出）
#   db-backup / db-restore / db-list   本地库备份/恢复/列表
switch ($Command.ToLower()) {
  { $_ -in @("restart", "start") } { Start-All "restart" }
  "fresh" {
    Write-Host "将清空本地数据库 $dbName 的全部数据" -ForegroundColor Red
    $confirm = Read-Host "确认请输入 yes"
    if ($confirm -ne "yes") { Write-Host "已取消"; return }
    Start-All "fresh"
  }
  "stop" { Stop-Services }
  "status" { Show-Status }
  "db-backup" { Invoke-DbBackup $Arg1 }
  "db-restore" { Invoke-DbRestore $Arg1 }
  "db-list" { Show-BackupList }
  "logs" {
    if (-not (Test-Path $serverLog)) { Fail "尚未启动过（.run\server.log 不存在）" }
    Write-Host "跟踪后端输出（Ctrl+C 退出；前端输出见 .run\web.log）" -ForegroundColor Cyan
    Get-Content $serverLog -Tail 30 -Wait -Encoding UTF8
  }
  default {
    Write-Host "未知命令: $Command"
    Write-Host "可用: restart(默认) / fresh / start / stop / status / logs / db-backup / db-restore / db-list"
    exit 1
  }
}
