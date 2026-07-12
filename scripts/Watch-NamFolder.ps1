param(
  [Parameter(Mandatory = $true)]
  [string]$Folder,

  [int]$IntervalSeconds = 10,

  [string]$LogPath = "$env:APPDATA\nam-lab\nam-folder-watch.log"
)

$ErrorActionPreference = 'Continue'

function Write-WatchLog {
  param([string]$Message)
  $dir = Split-Path -Parent $LogPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $line = "[{0}] {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-NamSnapshot {
  param([string]$Path)
  $snapshot = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $snapshot
  }

  Get-ChildItem -LiteralPath $Path -Filter *.nam -File -ErrorAction SilentlyContinue | ForEach-Object {
    $hash = ''
    try {
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
    } catch {
      $hash = "HASH_ERROR:$($_.Exception.Message)"
    }
    $snapshot[$_.FullName] = [pscustomobject]@{
      Length = $_.Length
      LastWriteUtc = $_.LastWriteTimeUtc.ToString("o")
      Hash = $hash
    }
  }
  return $snapshot
}

if (-not (Test-Path -LiteralPath $Folder)) {
  Write-WatchLog "START-FAILED folder-missing folder=`"$Folder`""
  throw "Folder not found: $Folder"
}

Write-WatchLog "START folder=`"$Folder`" intervalSeconds=$IntervalSeconds pid=$PID"
$previous = Get-NamSnapshot -Path $Folder
Write-WatchLog "BASELINE files=$($previous.Count)"

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $Folder
$watcher.Filter = '*.nam'
$watcher.IncludeSubdirectories = $false
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size, CreationTime'
$watcher.EnableRaisingEvents = $true

$handlers = @()
foreach ($eventName in @('Created', 'Changed', 'Deleted')) {
  $handlers += Register-ObjectEvent -InputObject $watcher -EventName $eventName -Action {
    $path = $Event.SourceEventArgs.FullPath
    $change = $Event.SourceEventArgs.ChangeType
    Write-WatchLog "FSW $change path=`"$path`""
  }
}
$handlers += Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action {
  $oldPath = $Event.SourceEventArgs.OldFullPath
  $path = $Event.SourceEventArgs.FullPath
  Write-WatchLog "FSW Renamed old=`"$oldPath`" path=`"$path`""
}

try {
  while ($true) {
    Start-Sleep -Seconds $IntervalSeconds
    $current = Get-NamSnapshot -Path $Folder

    foreach ($path in $current.Keys) {
      if (-not $previous.ContainsKey($path)) {
        $item = $current[$path]
        Write-WatchLog "POLL Created path=`"$path`" length=$($item.Length) lastWriteUtc=$($item.LastWriteUtc) hash=$($item.Hash)"
        continue
      }
      $old = $previous[$path]
      $new = $current[$path]
      if ($old.Length -ne $new.Length -or $old.LastWriteUtc -ne $new.LastWriteUtc -or $old.Hash -ne $new.Hash) {
        Write-WatchLog "POLL Changed path=`"$path`" oldLength=$($old.Length) newLength=$($new.Length) oldLastWriteUtc=$($old.LastWriteUtc) newLastWriteUtc=$($new.LastWriteUtc) oldHash=$($old.Hash) newHash=$($new.Hash)"
      }
    }

    foreach ($path in $previous.Keys) {
      if (-not $current.ContainsKey($path)) {
        $old = $previous[$path]
        Write-WatchLog "POLL Deleted path=`"$path`" oldLength=$($old.Length) oldLastWriteUtc=$($old.LastWriteUtc) oldHash=$($old.Hash)"
      }
    }

    $previous = $current
  }
} finally {
  foreach ($handler in $handlers) {
    Unregister-Event -SubscriptionId $handler.Id -ErrorAction SilentlyContinue
  }
  $watcher.Dispose()
  Write-WatchLog "STOP folder=`"$Folder`" pid=$PID"
}
