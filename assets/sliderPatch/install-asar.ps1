param(
  [switch]$Uninstall,
  [string]$AsarPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CliScript = Join-Path $RootDir "tools\cli-install.cjs"

$nodeArgs = @($CliScript)
if ($Uninstall) {
  $nodeArgs += "--uninstall"
}
if ($AsarPath -ne "") {
  $nodeArgs += "--asar"
  $nodeArgs += $AsarPath
}

& node @nodeArgs
exit $LASTEXITCODE
