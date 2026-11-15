$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'This setup script supports Windows x64. Run it from 64-bit PowerShell.'
}

$ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$wingetFfmpeg = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
if (-not $ffmpeg -and -not (Test-Path -LiteralPath $wingetFfmpeg)) {
    throw 'Install FFmpeg with winget install --exact --id Gyan.FFmpeg. Open a new PowerShell window and run setup again.'
}

$root = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'io.github.ethanramli.excalitutor'
$model = Join-Path $root 'models\ggml-base.en.bin'
$whisper = Join-Path $root 'tools\whisper-cli'
$work = Join-Path $root ('.setup-' + [Guid]::NewGuid())

function Test-Hash($Path, $Algorithm, $Expected) {
    (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash -eq $Expected)
}

New-Item -ItemType Directory -Force -Path $work, (Split-Path $model), $whisper | Out-Null
try {
    $exe = Join-Path $whisper 'whisper-cli.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        $archive = Join-Path $work 'whisper.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip' -OutFile $archive
        if (-not (Test-Hash $archive SHA256 '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb')) {
            throw 'The downloaded Whisper archive failed its checksum.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $work
        $release = Join-Path $work 'Release'
        Copy-Item -Path (Join-Path $release '*.dll') -Destination $whisper -Force
        Copy-Item -LiteralPath (Join-Path $release 'whisper-cli.exe') -Destination $exe -Force
    }

    $probe = Start-Process -FilePath $exe -ArgumentList '--help' -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput (Join-Path $work 'whisper-out.txt') -RedirectStandardError (Join-Path $work 'whisper-err.txt')
    if ($probe.ExitCode -ne 0) {
        throw 'Whisper could not start. Install the Microsoft Visual C++ x64 Redistributable and try setup again.'
    }

    $sha1 = '137c40403d78fd54d454da0f9bd998f78703390c'
    if (-not (Test-Hash $model SHA1 $sha1)) {
        $part = Join-Path $work 'model.bin'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' -OutFile $part
        if (-not (Test-Hash $part SHA1 $sha1)) {
            throw 'The downloaded English model failed its checksum.'
        }
        Move-Item -LiteralPath $part -Destination $model -Force
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

Write-Output 'Offline English transcription is ready. Open Excali Tutor and select Record to use your microphone.'
