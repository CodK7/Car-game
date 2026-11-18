# Tiny local web server for the shared build. Needs nothing installed: PowerShell ships with Windows.
# Serves ./game on 127.0.0.1 only (not reachable from other machines) and opens the default browser.
param([int]$Port = 8080, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'game'))
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.mjs' = 'text/javascript'; '.css' = 'text/css'
  '.json' = 'application/json'; '.wasm' = 'application/wasm'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.bin' = 'application/octet-stream'; '.glb' = 'model/gltf-binary'
  '.wav' = 'audio/wav'; '.txt' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'
}

$listener = $null
for ($p = $Port; $p -lt $Port + 30; $p++) {
  try { $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p); $listener.Start(); break }
  catch { $listener = $null }
}
if (-not $listener) { Write-Host "No free port between $Port and $($Port + 29)."; exit 1 }
$url = "http://127.0.0.1:$p/"
Write-Host ''
Write-Host "  Wahiba Sands Off-Road  ->  $url"
Write-Host '  The game opens in your browser. Keep this window open while you play; close it to stop.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

function Send-Head($stream, [string]$status, [string]$type, [long]$length) {
  $h = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $b = [System.Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($b, 0, $b.Length)
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 30000
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $line = $reader.ReadLine()
    while ($true) { $h = $reader.ReadLine(); if ($null -eq $h -or $h -eq '') { break } }
    if (-not $line) { continue }
    $parts = $line.Split(' ')
    $method = $parts[0]
    $path = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
    if (($method -ne 'GET' -and $method -ne 'HEAD') -or -not $file.StartsWith($root) -or -not [System.IO.File]::Exists($file)) {
      Send-Head $stream '404 Not Found' 'text/plain' 0
      continue
    }
    $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
    $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
    $fs = [System.IO.File]::OpenRead($file)
    try {
      Send-Head $stream '200 OK' $type $fs.Length
      if ($method -eq 'GET') { $fs.CopyTo($stream, 65536) }
    } finally { $fs.Dispose() }
  } catch {
    # browser closed the connection or a speculative socket timed out: ignore
  } finally {
    $client.Close()
  }
}
