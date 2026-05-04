#Requires -Version 5.1
<#
.SYNOPSIS
  Memoria 一键发版脚本。

.DESCRIPTION
  完整流程：
    1. 从源码目录（memoria-v1.1.1-source）执行 npm run build
    2. 把 main.js / manifest.json / styles.css / CHANGELOG.md 同步到本目录
    3. 同步到 Obsidian vault 的插件加载目录（方便本地测试）
    4. 读取 manifest.json 得到新版本号 vX.Y.Z
    5. git add / commit / tag / push
    6. 调 GitHub REST API 创建 Release（可选，需要 GITHUB_TOKEN 环境变量）
       同时把三件套作为 Release Assets 上传

.PARAMETER SkipBuild
  跳过 npm run build（假设已经 build 过）

.PARAMETER SkipRelease
  只推送 commit 和 tag，不在 GitHub 创建 Release（Release 手动去网页发）

.PARAMETER DryRun
  只展示会做什么，不真实执行写操作

.EXAMPLE
  # 标准发版（需要先 export $env:GITHUB_TOKEN='ghp_xxx'）
  .\publish.ps1

.EXAMPLE
  # 跳过 build，只做发布
  .\publish.ps1 -SkipBuild

.EXAMPLE
  # 预演
  .\publish.ps1 -DryRun

.NOTES
  作者：ZOLO
  首版：v1.4.11 发布日（2026-05-05）
#>

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipRelease,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ============ 配置 ============
$ReleaseDir = 'C:\Users\zololiu\Desktop\memoria-release'
$SourceDir  = 'C:\Users\zololiu\Desktop\memoria-v1.1.1-source'
$VaultDir   = 'D:\NAS\Notes\Obsidian\.obsidian\plugins\memoria'
$GitHubOwner = 'i-iooi-i'
$GitHubRepo  = 'obsidian-memoria'

# ============ 工具函数 ============
function Write-Step($Msg) {
  Write-Host ""
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Invoke-Git {
  param([string[]]$Args)
  if ($DryRun) {
    Write-Host "[DRY] git $($Args -join ' ')" -ForegroundColor DarkGray
    return ""
  }
  # 避免 PowerShell 把 git 的 stderr 进度信息当错误；合并流
  & git @Args 2>&1 | ForEach-Object { $_.ToString() }
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') 失败，exit=$LASTEXITCODE"
  }
}

function Copy-One($From, $To) {
  if ($DryRun) {
    Write-Host "[DRY] Copy $From -> $To" -ForegroundColor DarkGray
    return
  }
  Copy-Item -Force -Path $From -Destination $To
}

# ============ Step 1. Build ============
Set-Location $ReleaseDir

if (-not $SkipBuild) {
  Write-Step "Step 1/6  编译源码（npm run build）"
  Push-Location $SourceDir
  try {
    if ($DryRun) {
      Write-Host "[DRY] npm run build" -ForegroundColor DarkGray
    } else {
      npm run build
      if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Step "Step 1/6  跳过构建 (-SkipBuild)"
}

# ============ Step 2. 同步三件套到 release 目录 ============
Write-Step "Step 2/6  同步三件套 + CHANGELOG 到 release 目录"
Copy-One "$SourceDir\main.js"        "$ReleaseDir\main.js"
Copy-One "$SourceDir\manifest.json"  "$ReleaseDir\manifest.json"
Copy-One "$SourceDir\styles.css"     "$ReleaseDir\styles.css"
Copy-One "$SourceDir\CHANGELOG.md"   "$ReleaseDir\CHANGELOG.md"

# ============ Step 3. 同步到 Obsidian vault ============
Write-Step "Step 3/6  同步到 Obsidian vault ($VaultDir)"
if (Test-Path $VaultDir) {
  Copy-One "$ReleaseDir\main.js"        "$VaultDir\main.js"
  Copy-One "$ReleaseDir\manifest.json"  "$VaultDir\manifest.json"
  Copy-One "$ReleaseDir\styles.css"     "$VaultDir\styles.css"
  Write-Host "  vault 已更新，记得重启 Memoria 插件生效" -ForegroundColor Yellow
} else {
  Write-Host "  vault 目录不存在，跳过（$VaultDir）" -ForegroundColor DarkYellow
}

# ============ Step 4. 读取版本号 ============
Write-Step "Step 4/6  读取 manifest.json 版本号"
$manifestRaw = Get-Content "$ReleaseDir\manifest.json" -Encoding UTF8 -Raw
$manifest = $manifestRaw | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"
Write-Host "  版本号：$version  →  tag: $tag" -ForegroundColor Green

# ============ Step 5. Git commit + tag + push ============
Write-Step "Step 5/6  git commit + tag + push"

# 检查 versions.json 是否包含新版本，没有就补上
$versionsPath = "$ReleaseDir\versions.json"
if (Test-Path $versionsPath) {
  $versionsRaw = Get-Content $versionsPath -Encoding UTF8 -Raw
  if (-not ($versionsRaw -match [regex]::Escape("`"$version`""))) {
    Write-Host "  versions.json 不包含 $version，自动追加" -ForegroundColor Yellow
    $versions = $versionsRaw | ConvertFrom-Json
    $versions | Add-Member -NotePropertyName $version -NotePropertyValue $manifest.minAppVersion -Force
    if (-not $DryRun) {
      # 按 Obsidian 习惯：pretty print 2-space 缩进
      $json = $versions | ConvertTo-Json -Depth 5
      [System.IO.File]::WriteAllText($versionsPath, $json, [System.Text.UTF8Encoding]::new($false))
    }
  }
}

# 检查是否有改动
Invoke-Git @('add', '-A')
$statusRaw = & git status --short 2>&1 | Out-String
if ([string]::IsNullOrWhiteSpace($statusRaw)) {
  Write-Host "  没有需要提交的改动，跳过 commit" -ForegroundColor DarkYellow
} else {
  $commitMsg = "v$version"
  Invoke-Git @('commit', '-m', $commitMsg) | Out-Null
  Write-Host "  已 commit: $commitMsg" -ForegroundColor Green
}

# 打 tag（已存在就跳过）
$existingTag = & git tag --list $tag 2>&1 | Out-String
if ($existingTag.Trim() -eq $tag) {
  Write-Host "  tag $tag 已存在，跳过打 tag" -ForegroundColor DarkYellow
} else {
  Invoke-Git @('tag', '-a', $tag, '-m', "Memoria $tag") | Out-Null
  Write-Host "  已打 tag: $tag" -ForegroundColor Green
}

# Push 分支 + tag
Invoke-Git @('push', 'origin', 'main') | Out-Null
Invoke-Git @('push', 'origin', $tag)   | Out-Null
Write-Host "  已 push main + $tag 到 origin" -ForegroundColor Green

# ============ Step 6. GitHub Release ============
if ($SkipRelease) {
  Write-Step "Step 6/6  跳过 GitHub Release (-SkipRelease)"
  Write-Host "  手动到 https://github.com/$GitHubOwner/$GitHubRepo/releases/new?tag=$tag 发布" -ForegroundColor Yellow
  return
}

$token = $env:GITHUB_TOKEN
if (-not $token) {
  Write-Step "Step 6/6  未设置 GITHUB_TOKEN 环境变量，跳过自动 Release"
  Write-Host "  手动到 https://github.com/$GitHubOwner/$GitHubRepo/releases/new?tag=$tag 发布" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  下次想让脚本自动发 Release，先在 PowerShell 里运行一次："
  Write-Host "    `$env:GITHUB_TOKEN = 'ghp_xxxxx'     # 需要 public_repo 权限" -ForegroundColor DarkGray
  Write-Host "  或者加到 `$PROFILE 里永久生效。"
  return
}

Write-Step "Step 6/6  通过 GitHub API 创建 Release"

# 从 CHANGELOG.md 里抽出本版本段作为 Release body（从 "## v$version" 到下一个 "## " 之前）
$changelogRaw = Get-Content "$ReleaseDir\CHANGELOG.md" -Encoding UTF8 -Raw
$pattern = "(?ms)^##\s+v$([regex]::Escape($version))[^\n]*\n(.+?)(?=\n##\s+v|\z)"
$match = [regex]::Match($changelogRaw, $pattern)
$body = if ($match.Success) { $match.Groups[1].Value.Trim() } else { "See CHANGELOG.md" }

$headers = @{
  'Accept'               = 'application/vnd.github+json'
  'Authorization'        = "Bearer $token"
  'X-GitHub-Api-Version' = '2022-11-28'
}

# 先检查 Release 是否已存在
$releaseApiUrl = "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/releases/tags/$tag"
$existing = $null
try {
  $existing = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -Method Get
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}

if ($existing) {
  Write-Host "  Release $tag 已存在（id=$($existing.id)），重用不新建" -ForegroundColor DarkYellow
  $release = $existing
} else {
  $createBody = @{
    tag_name = $tag
    name     = "Memoria $tag"
    body     = $body
    draft    = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 10
  if ($DryRun) {
    Write-Host "[DRY] POST /releases body:" -ForegroundColor DarkGray
    Write-Host $createBody -ForegroundColor DarkGray
    return
  }
  $release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/releases" `
    -Headers $headers -Method Post -Body $createBody -ContentType 'application/json; charset=utf-8'
  Write-Host "  Release 已创建：$($release.html_url)" -ForegroundColor Green
}

# 上传资产：main.js / manifest.json / styles.css
$assets = @('main.js', 'manifest.json', 'styles.css')
# 先列出已有资产，同名的先删再重传
$existingAssets = @{}
foreach ($a in $release.assets) {
  $existingAssets[$a.name] = $a
}

foreach ($name in $assets) {
  $filePath = Join-Path $ReleaseDir $name
  if (-not (Test-Path $filePath)) {
    Write-Host "  ! 文件不存在，跳过：$filePath" -ForegroundColor Red
    continue
  }
  if ($existingAssets.ContainsKey($name)) {
    Write-Host "  删除旧 asset：$name"
    if (-not $DryRun) {
      Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/releases/assets/$($existingAssets[$name].id)" `
        -Headers $headers -Method Delete | Out-Null
    }
  }
  $uploadUrl = $release.upload_url -replace '\{\?name,label\}', "?name=$name"
  $contentType = switch -Regex ($name) {
    '\.js$'   { 'application/javascript; charset=utf-8'; break }
    '\.css$'  { 'text/css; charset=utf-8'; break }
    '\.json$' { 'application/json; charset=utf-8'; break }
    default   { 'application/octet-stream' }
  }
  Write-Host "  上传 asset：$name ($contentType)"
  if ($DryRun) {
    Write-Host "[DRY] PUT $uploadUrl" -ForegroundColor DarkGray
    continue
  }
  # 用 FileStream 读取为字节，避免 PowerShell 文本编码破坏二进制
  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  Invoke-RestMethod -Uri $uploadUrl -Headers $headers -Method Post `
    -Body $bytes -ContentType $contentType | Out-Null
}

Write-Host ""
Write-Host "✅ 发布完成！" -ForegroundColor Green
Write-Host "   Release URL: $($release.html_url)" -ForegroundColor Green
