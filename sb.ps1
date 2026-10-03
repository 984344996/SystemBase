# ============================================================
# SystemBase 统一入口：一套命令操作全部环境（Windows PowerShell 版，Mac/Linux 请用 sb.sh）
# 在项目根目录执行；首次可能需要 Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#
# 环境（配置文件都在 deploy\envs\，复制 *.env.example 为实际文件后填写）:
#   local            本地开发（你的电脑：watch 模式 + 本机数据库）
#   remote-pre       远程预发布（SSH 上传发布，配置 deploy\envs\remote-pre.env）
#   remote-release   远程正式   （SSH 上传发布，配置 deploy\envs\remote-release.env）
#
# 用法:
#   .\sb.ps1 local [start|fresh|stop|status|logs]      本地启动（默认 start）
#   .\sb.ps1 remote-pre <命令>                         预发布环境操作
#   .\sb.ps1 remote-release <命令>                     正式环境操作
#
#   远程 <命令>: deploy(默认，发布) | init(首次初始化服务器) | fresh(重置数据) |
#               status | logs | releases | rollback | restart | start | stop |
#               ssl 域名 | db-remote-on/off | ssh
#
# 示例:
#   .\sb.ps1 local start                # 本地一键启动
#   .\sb.ps1 remote-pre init            # 首次初始化预发布服务器并发布
#   .\sb.ps1 remote-pre deploy          # 发布到预发布
#   .\sb.ps1 remote-release status      # 正式环境服务状态
#   .\sb.ps1 remote-release logs error  # 查看正式环境今日错误日志
#   .\sb.ps1 remote-release ssh         # 登录正式服务器
# ============================================================
param(
  [Parameter(Position = 0)][string]$Environment = "",
  [Parameter(Position = 1)][string]$Command = "",
  [Parameter(Position = 2)][string]$Arg1 = "",
  [Parameter(Position = 3)][string]$Arg2 = ""
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

function Show-Usage {
  Get-Content $PSCommandPath -Encoding UTF8 | Select-Object -Skip 2 -First 23 | ForEach-Object { $_ -replace '^# ?', '' }
  Write-Host ""
  Write-Host "已配置的环境（deploy\envs\）:" -ForegroundColor Cyan
  $envsDir = Join-Path $root "deploy\envs"
  if (Test-Path $envsDir) {
    foreach ($f in (Get-ChildItem (Join-Path $envsDir "*.env") -ErrorAction SilentlyContinue)) {
      $name = $f.BaseName
      switch ($name) {
        "local" { Write-Host "  local            本地开发" }
        "remote-pre" { Write-Host "  remote-pre       远程预发布" }
        "remote-release" { Write-Host "  remote-release   远程正式" }
        default { Write-Host "  $name" }
      }
    }
  }
  exit 1
}

function Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

if (-not $Environment -or $Environment -in @("-h", "--help", "help")) { Show-Usage }

switch ($Environment) {
  "local" {
    if (-not $Command) { $Command = "restart" }
    & powershell -ExecutionPolicy Bypass -File (Join-Path $root "start-local.ps1") $Command
    exit $LASTEXITCODE
  }
  { $_ -like "remote-*" } {
    $envsFile = Join-Path $root "deploy\envs\$Environment.env"
    if (-not (Test-Path $envsFile)) { Fail "缺少 $envsFile（复制 .env.example 后填写）" }
    if (-not $Command) { $Command = "deploy" }
    & powershell -ExecutionPolicy Bypass -File (Join-Path $root "deploy.ps1") $Environment $Command $Arg1 $Arg2
    exit $LASTEXITCODE
  }
  default { Fail "未知环境: $Environment（可用: local / remote-pre / remote-release，见 .\sb.ps1 help）" }
}
