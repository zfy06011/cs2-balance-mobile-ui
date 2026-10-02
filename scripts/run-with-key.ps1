#requires -Version 7.0
param([ValidateSet(6,20,50)][int]$Stage = 6, [ValidateSet(1,3)][int]$Runs = 1)
$ErrorActionPreference = 'Stop'
$secureKey = Read-Host '输入新生成的 C5 app-key（隐藏输入，不写入文件）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $env:C5_VALIDATION_APP_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    for ($run = 1; $run -le $Runs; $run++) {
        if ($run -gt 1) { Start-Sleep -Seconds 30 }
        & node (Join-Path $PSScriptRoot 'probe.mjs') scan --stage $Stage
        $probeExit = $LASTEXITCODE
        if ($probeExit -ne 0) { break }
    }
} finally {
    Remove-Item Env:\C5_VALIDATION_APP_KEY -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureKey.Dispose()
}
exit $probeExit
