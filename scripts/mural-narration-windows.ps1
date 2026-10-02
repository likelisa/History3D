# Local, explicitly invoked authoring utility. Normal build never synthesizes or contacts a provider.
param([Parameter(Mandatory=$true)][string]$InputJson, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$muralCues = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
$muralOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $muralOutput) { throw 'Choose a new audio directory; existing recordings are preserved.' }
[IO.Directory]::CreateDirectory($muralOutput) | Out-Null
$muralSpeaker = New-Object -ComObject SAPI.SpVoice
$muralChinese = @($muralSpeaker.GetVoices() | Where-Object { $_.GetDescription() -match 'Huihui.*Chinese' })
if ($muralChinese.Count -ne 1) { throw 'Microsoft Huihui Desktop Chinese voice is required for this explicit Windows recipe.' }
$muralSpeaker.Voice = $muralChinese[0]
$muralSpeaker.Rate = -2
$muralSpeaker.Volume = 100
foreach ($muralCue in $muralCues.cues) {
    if ($muralCue.id -notmatch '^c[0-7]-[0-2]$') { throw 'Invalid cue id.' }
    $muralWavePath = [IO.Path]::Combine($muralOutput, $muralCue.id + '.wav')
    $muralStream = New-Object -ComObject SAPI.SpFileStream
    $muralStream.Format.Type = 22 # 22.05kHz, 16-bit, mono PCM
    $muralStream.Open($muralWavePath, 3, $false)
    $muralSpeaker.AudioOutputStream = $muralStream
    [void]$muralSpeaker.Speak([string]$muralCue.text, 0)
    $muralStream.Close()
    Write-Output ('Recorded ' + $muralCue.id)
}
