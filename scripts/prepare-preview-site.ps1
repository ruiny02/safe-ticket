Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$previewRoot = Join-Path $repoRoot ".preview\site"
$productDemoRoot = Join-Path $repoRoot "apps\frontend\demo\joongna-product-demo"
$chatDemoRoot = Join-Path $repoRoot "apps\frontend\trade-chat-demo"
$reportPageRoot = Join-Path $repoRoot "apps\frontend\report-page"
$reportDistRoot = Join-Path $reportPageRoot "dist"

Write-Host "[safe-ticket] Building report-page..."
& corepack pnpm --dir $reportPageRoot build

if (Test-Path $previewRoot) {
  Remove-Item -LiteralPath $previewRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $previewRoot | Out-Null

Write-Host "[safe-ticket] Copying product demo files..."
Copy-Item -Path (Join-Path $productDemoRoot "*") -Destination $previewRoot -Recurse -Force

Write-Host "[safe-ticket] Copying chat demo files..."
Get-ChildItem -Path $chatDemoRoot -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $previewRoot -Force
}

$previewReportRoot = Join-Path $previewRoot "report"
New-Item -ItemType Directory -Path $previewReportRoot | Out-Null

Write-Host "[safe-ticket] Copying report-page build..."
Copy-Item -Path (Join-Path $reportDistRoot "*") -Destination $previewReportRoot -Recurse -Force

Write-Host "[safe-ticket] Preview site prepared at $previewRoot"
