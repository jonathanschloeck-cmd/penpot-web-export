# Kleiner lokaler Server, damit Penpot das Plugin laden kann (ohne Node.js).
# Start: Doppelklick auf start-server.cmd, beenden mit Strg+C.
param([int]$Port = 4400)

$root = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\') + '\'
$types = @{
  '.json' = 'application/json; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host ""
Write-Host "  Web-Export-Plugin laeuft." -ForegroundColor Green
Write-Host "  In Penpot Strg+Alt+P druecken und diese Adresse einfuegen:"
Write-Host ""
Write-Host "    http://localhost:$Port/manifest.json" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Fenster offen lassen, solange du das Plugin benutzt. Beenden mit Strg+C."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $response.Headers.Add('Access-Control-Allow-Origin', '*')
    $response.Headers.Add('Access-Control-Allow-Headers', '*')
    $response.Headers.Add('Access-Control-Allow-Private-Network', 'true')
    $response.Headers.Add('Cache-Control', 'no-store')

    if ($request.HttpMethod -eq 'OPTIONS') {
      $response.StatusCode = 204
      $response.Close()
      continue
    }

    $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
    if (-not $relative) { $relative = 'manifest.json' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
    $ext = [IO.Path]::GetExtension($path).ToLower()

    if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
        -not $types.ContainsKey($ext) -or
        -not (Test-Path -LiteralPath $path -PathType Leaf)) {
      $response.StatusCode = 404
      $response.Close()
      continue
    }

    try {
      $bytes = [IO.File]::ReadAllBytes($path)
      $response.ContentType = $types[$ext]
      $response.ContentLength64 = $bytes.Length
      if ($request.HttpMethod -ne 'HEAD') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
      Write-Host ("  {0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $relative) -ForegroundColor DarkGray
    } catch {
      Write-Host "  Fehler bei $relative : $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
      try { $response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
