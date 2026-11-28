[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ArquivoDpapi,
    [switch]$Compilar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $identity = [System.BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '')
} finally { $sha.Dispose() }
$mutex = [Threading.Mutex]::new($false, "Local\CSAgendaPro-$identity")
$ownsMutex = $false
$pointer = [IntPtr]::Zero
$node = $null
$previousKey = $env:CREDENTIAL_ENCRYPTION_KEY
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { throw 'Já existe um inicializador ativo para esta instalação.' }

    if (!(Test-Path -LiteralPath $ArquivoDpapi -PathType Leaf)) { throw 'Arquivo DPAPI existente não encontrado.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $secret = ConvertTo-SecureString -String ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $ArquivoDpapi).Path).Trim())
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $env:CREDENTIAL_ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($env:CREDENTIAL_ENCRYPTION_KEY -notmatch '^[a-fA-F0-9]{64}$') { throw 'A chave recuperada do DPAPI é inválida.' }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $pointer = [IntPtr]::Zero
    $secret.Dispose()

    Push-Location $root
    try {
        $cli = @('--import', 'tsx', 'scripts/windows-runtime.ts')
        if ($Compilar) { $cli += '--build' }
        & $node @cli
        if ($LASTEXITCODE -ne 0) { throw 'A inicialização não foi concluída. Consulte o registro local.' }
    } finally { Pop-Location }
} catch {
    [Console]::Error.WriteLine('Inicialização do CS Agenda Pro interrompida. Verifique o arquivo DPAPI, a instalação e o registro local.')
    exit 1
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -eq $previousKey) { Remove-Item Env:CREDENTIAL_ENCRYPTION_KEY -ErrorAction SilentlyContinue }
    else { $env:CREDENTIAL_ENCRYPTION_KEY = $previousKey }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
