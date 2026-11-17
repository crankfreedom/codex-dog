param([Parameter(Mandatory=$true)][string]$CliPath)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { exit 0 }
try {
  $resolvedCli = [System.IO.Path]::GetFullPath($CliPath)
  $imageName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedCli)
  foreach ($candidate in [System.Diagnostics.Process]::GetProcessesByName($imageName)) {
    try {
      $imagePath = [System.IO.Path]::GetFullPath($candidate.MainModule.FileName)
      if ([System.StringComparer]::OrdinalIgnoreCase.Equals($resolvedCli, $imagePath)) { exit 73 }
    } catch { exit 73 }
  }
  $handle = [System.IO.File]::Open($resolvedCli, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $handle.Dispose()
  exit 0
} catch {
  # 不结束占用者、不删文件；交给用户关闭长期 CLI/MCP 后重试。
  exit 73
}
