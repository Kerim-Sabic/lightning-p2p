# Renders the master 1024x1024 app icon in the Lightning P2P speed-lab brand:
# a rounded lab-black tile with a glowing signal-green bolt and packet accents.
#
# Regenerate every platform size (ico, Windows Store logos, Android mipmaps)
# from the master with the Tauri CLI afterwards:
#
#   powershell -ExecutionPolicy Bypass -File scripts/render-app-icon.ps1
#   pnpm tauri icon src-tauri/icons/master-icon-1024.png

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outPath = Join-Path $PSScriptRoot "..\src-tauri\icons\master-icon-1024.png"
$size = 1024

$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Windows 11 app tiles read best as a rounded square (~22% corner radius).
$radius = 220
$inset = 8
$tile = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$w = $size - 2 * $inset
$tile.AddArc($inset, $inset, $d, $d, 180, 90)
$tile.AddArc($inset + $w - $d, $inset, $d, $d, 270, 90)
$tile.AddArc($inset + $w - $d, $inset + $w - $d, $d, $d, 0, 90)
$tile.AddArc($inset, $inset + $w - $d, $d, $d, 90, 90)
$tile.CloseFigure()

# Lab surface: black-green diagonal gradient.
$gradRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $gradRect,
  [System.Drawing.Color]::FromArgb(255, 6, 9, 8),
  [System.Drawing.Color]::FromArgb(255, 14, 33, 25),
  [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillPath($bg, $tile)
$bg.Dispose()

# Everything decorative stays clipped inside the tile.
$g.SetClip($tile)

# Faint bench grid.
$gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(26, 125, 223, 156), 3)
for ($x = 128; $x -lt $size; $x += 128) { $g.DrawLine($gridPen, $x, 0, $x, $size) }
for ($y = 128; $y -lt $size; $y += 128) { $g.DrawLine($gridPen, 0, $y, $size, $y) }
$gridPen.Dispose()

# Soft radial glow behind the bolt.
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(212, 152, 600, 720)
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$glow.CenterColor = [System.Drawing.Color]::FromArgb(72, 125, 223, 156)
$glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 125, 223, 156))
$g.FillEllipse($glow, 212, 152, 600, 720)
$glow.Dispose()
$glowPath.Dispose()

# The bolt. Same silhouette as the installer art, scaled to hero size.
function Get-BoltPoints([single]$x, [single]$y, [single]$scale) {
  $raw = @(
    @(0.62, 0.00), @(0.18, 0.56), @(0.44, 0.56),
    @(0.34, 1.00), @(0.82, 0.40), @(0.52, 0.40)
  )
  $pts = @()
  foreach ($p in $raw) {
    $pts += New-Object System.Drawing.PointF(($x + $p[0] * $scale), ($y + $p[1] * $scale))
  }
  return $pts
}

# Dark keyline behind the bolt so it separates from the glow at small sizes.
$shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 4, 7, 5))
$g.FillPolygon($shadow, (Get-BoltPoints 236 200 656))
$shadow.Dispose()

$bolt = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 125, 223, 156))
$g.FillPolygon($bolt, (Get-BoltPoints 220 184 656))
$bolt.Dispose()

# Amber packet squares trailing off the bolt tip: data in flight.
$packets = @(
  @(700, 306, 30), @(760, 268, 24), @(812, 238, 18), @(854, 214, 12)
)
foreach ($p in $packets) {
  $alpha = [int](225 - 45 * $packets.IndexOf($p))
  $bAmber = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 240, 199, 107))
  $g.FillRectangle($bAmber, [single]$p[0], [single]$p[1], [single]$p[2], [single]$p[2])
  $bAmber.Dispose()
}

$g.ResetClip()

# Hairline inner border keeps the tile crisp on light backgrounds.
$border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 255, 255, 255), 6)
$g.DrawPath($border, $tile)
$border.Dispose()

$g.Dispose()
$bmp.Save((Join-Path $PSScriptRoot "..\src-tauri\icons\master-icon-1024.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save((Join-Path $env:TEMP "claude-preview-app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$tile.Dispose()
Write-Host "wrote $outPath"
