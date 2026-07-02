# Renders the Windows installer artwork (NSIS header/sidebar, WiX banner/dialog)
# in the Lightning P2P "speed lab" brand: lab-black surfaces, signal-green
# oscilloscope traces, packet squares, and a clean wordmark.
#
# Reproducible: run from the repo root, output lands in src-tauri/icons/installer.
#
#   powershell -ExecutionPolicy Bypass -File scripts/render-installer-art.ps1
#
# Sizes are fixed by the installer frameworks:
#   NSIS MUI2 header  150x57   NSIS MUI2 sidebar 164x314
#   WiX banner        493x58   WiX dialog        493x312

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\src-tauri\icons\installer"
$outDir = (Resolve-Path $outDir).Path

# Brand palette (DESIGN.md)
$labBlack    = [System.Drawing.Color]::FromArgb(255,   5,   7,   6)
$labGreen    = [System.Drawing.Color]::FromArgb(255,  10,  22,  17)
$gridGreen   = [System.Drawing.Color]::FromArgb( 70,  20,  40,  31)
$signalGreen = [System.Drawing.Color]::FromArgb(255, 125, 223, 156)
$proofAmber  = [System.Drawing.Color]::FromArgb(255, 240, 199, 107)
$proofPaper  = [System.Drawing.Color]::FromArgb(255, 248, 250, 247)
$dimGreen    = [System.Drawing.Color]::FromArgb(255, 138, 168, 148)

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @{ Bitmap = $bmp; G = $g }
}

function Fill-LabBackground($c, [int]$w, [int]$h) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect, $labBlack, $labGreen,
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $c.G.FillRectangle($brush, $rect)
  $brush.Dispose()
}

function Draw-Grid($c, [int]$w, [int]$h, [int]$step) {
  $pen = New-Object System.Drawing.Pen($gridGreen, 1)
  for ($x = $step; $x -lt $w; $x += $step) { $c.G.DrawLine($pen, $x, 0, $x, $h) }
  for ($y = $step; $y -lt $h; $y += $step) { $c.G.DrawLine($pen, 0, $y, $w, $y) }
  $pen.Dispose()
}

# A horizontal oscilloscope-style trace with soft glow. $points is an array of
# PointF the bezier chain passes through (must be 3n+1 points).
function Draw-Trace($c, $points, $color) {
  foreach ($layer in @(@{ W = 7; A = 26 }, @{ W = 4; A = 60 }, @{ W = 1.6; A = 255 })) {
    $glow = [System.Drawing.Color]::FromArgb($layer.A, $color.R, $color.G, $color.B)
    $pen = New-Object System.Drawing.Pen($glow, [single]$layer.W)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $c.G.DrawBeziers($pen, $points)
    $pen.Dispose()
  }
}

# Small "packet" squares strung along a line, fading out.
function Draw-Packets($c, [single]$x, [single]$y, [single]$dx, [single]$dy, [int]$count, $color) {
  for ($i = 0; $i -lt $count; $i++) {
    $alpha = [int](235 - (200 * $i / [math]::Max(1, $count - 1)))
    $size = 4 - [int]($i / 3)
    if ($size -lt 2) { $size = 2 }
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B))
    $c.G.FillRectangle($brush, $x + $dx * $i, $y + $dy * $i, $size, $size)
    $brush.Dispose()
  }
}

# The brand bolt: a sharp lightning glyph filled with signal green.
function Draw-Bolt($c, [single]$x, [single]$y, [single]$scale) {
  $raw = @(
    @(0.62, 0.00), @(0.18, 0.56), @(0.44, 0.56),
    @(0.34, 1.00), @(0.82, 0.40), @(0.52, 0.40)
  )
  $pts = @()
  foreach ($p in $raw) {
    $pts += New-Object System.Drawing.PointF(($x + $p[0] * $scale), ($y + $p[1] * $scale))
  }
  $halo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(46, $signalGreen.R, $signalGreen.G, $signalGreen.B))
  $haloPts = @()
  foreach ($p in $raw) {
    $haloPts += New-Object System.Drawing.PointF(($x - 0.06 * $scale + $p[0] * $scale * 1.12), ($y - 0.06 * $scale + $p[1] * $scale * 1.12))
  }
  $c.G.FillPolygon($halo, $haloPts)
  $halo.Dispose()
  $brush = New-Object System.Drawing.SolidBrush($signalGreen)
  $c.G.FillPolygon($brush, $pts)
  $brush.Dispose()
}

function Draw-Text($c, [string]$text, [string]$family, [single]$size, $style, $color, [single]$x, [single]$y) {
  $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush($color)
  $c.G.DrawString($text, $font, $brush, $x, $y)
  $brush.Dispose()
  $font.Dispose()
  return $null
}

function Save-Art($c, [string]$name) {
  $bmpPath = Join-Path $outDir "$name.bmp"
  $c.G.Dispose()
  $c.Bitmap.Save($bmpPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $preview = Join-Path $env:TEMP "claude-preview-$name.png"
  $c.Bitmap.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
  $c.Bitmap.Dispose()
  Write-Host "wrote $bmpPath"
}

$bold = [System.Drawing.FontStyle]::Bold
$regular = [System.Drawing.FontStyle]::Regular

# ---------------------------------------------------------------- NSIS sidebar
# 164x314, shown on Welcome and Finish pages. Vertical hero.
$c = New-Canvas 164 314
Fill-LabBackground $c 164 314
Draw-Grid $c 164 314 20

# Trace flowing down the panel.
$tracePts = @(
  (New-Object System.Drawing.PointF(-8, 96)),
  (New-Object System.Drawing.PointF(40, 66)),
  (New-Object System.Drawing.PointF(70, 132)),
  (New-Object System.Drawing.PointF(112, 104)),
  (New-Object System.Drawing.PointF(150, 78)),
  (New-Object System.Drawing.PointF(140, 158)),
  (New-Object System.Drawing.PointF(176, 148))
)
Draw-Trace $c $tracePts $signalGreen
Draw-Packets $c 18 178 13 9 9 $signalGreen
Draw-Packets $c 118 190 -11 10 6 $proofAmber

Draw-Bolt $c 18 18 34
Draw-Text $c "LIGHTNING" "Segoe UI" 24 $bold $proofPaper 12 218
Draw-Text $c "P2P" "Segoe UI" 24 $bold $signalGreen 12 246
Draw-Text $c "Direct. Verified." "Segoe UI" 12 $regular $dimGreen 13 282
Draw-Text $c "No cloud." "Segoe UI" 12 $regular $dimGreen 13 296
Save-Art $c "nsis-header-sidebar-tmp"
Move-Item -Force (Join-Path $outDir "nsis-header-sidebar-tmp.bmp") (Join-Path $outDir "nsis-sidebar.bmp")

# ----------------------------------------------------------------- NSIS header
# 150x57, top-right of installer pages.
$c = New-Canvas 150 57
Fill-LabBackground $c 150 57
Draw-Grid $c 150 57 14
$tracePts = @(
  (New-Object System.Drawing.PointF(-6, 40)),
  (New-Object System.Drawing.PointF(34, 18)),
  (New-Object System.Drawing.PointF(64, 52)),
  (New-Object System.Drawing.PointF(100, 30)),
  (New-Object System.Drawing.PointF(122, 16)),
  (New-Object System.Drawing.PointF(136, 40)),
  (New-Object System.Drawing.PointF(158, 34))
)
Draw-Trace $c $tracePts $signalGreen
Draw-Bolt $c 8 8 22
Draw-Packets $c 116 44 8 -1 4 $proofAmber
Save-Art $c "nsis-header"

# ------------------------------------------------------------------ WiX banner
# 493x58, top strip of MSI dialogs.
$c = New-Canvas 493 58
Fill-LabBackground $c 493 58
Draw-Grid $c 493 58 16
$tracePts = @(
  (New-Object System.Drawing.PointF(238, 40)),
  (New-Object System.Drawing.PointF(280, 16)),
  (New-Object System.Drawing.PointF(316, 52)),
  (New-Object System.Drawing.PointF(360, 26)),
  (New-Object System.Drawing.PointF(410, 8)),
  (New-Object System.Drawing.PointF(440, 44)),
  (New-Object System.Drawing.PointF(500, 30))
)
Draw-Trace $c $tracePts $signalGreen
Draw-Bolt $c 10 10 30
Draw-Text $c "LIGHTNING" "Segoe UI" 20 $bold $proofPaper 42 10
Draw-Text $c "P2P" "Segoe UI" 20 $bold $signalGreen 158 10
Draw-Text $c "Direct peer-to-peer file transfer" "Segoe UI" 11 $regular $dimGreen 44 36
Draw-Packets $c 452 18 9 4 4 $proofAmber
Save-Art $c "wix-banner"

# ------------------------------------------------------------------ WiX dialog
# 493x312, Welcome/Finish background for MSI.
$c = New-Canvas 493 312
Fill-LabBackground $c 493 312
Draw-Grid $c 493 312 24

$tracePts = @(
  (New-Object System.Drawing.PointF(-10, 210)),
  (New-Object System.Drawing.PointF(90, 160)),
  (New-Object System.Drawing.PointF(150, 258)),
  (New-Object System.Drawing.PointF(240, 196)),
  (New-Object System.Drawing.PointF(330, 140)),
  (New-Object System.Drawing.PointF(380, 240)),
  (New-Object System.Drawing.PointF(510, 186))
)
Draw-Trace $c $tracePts $signalGreen
$tracePts2 = @(
  (New-Object System.Drawing.PointF(-10, 250)),
  (New-Object System.Drawing.PointF(120, 226)),
  (New-Object System.Drawing.PointF(210, 286)),
  (New-Object System.Drawing.PointF(320, 244)),
  (New-Object System.Drawing.PointF(400, 214)),
  (New-Object System.Drawing.PointF(440, 268)),
  (New-Object System.Drawing.PointF(510, 252))
)
Draw-Trace $c $tracePts2 $proofAmber

Draw-Packets $c 60 120 16 6 10 $signalGreen
Draw-Packets $c 400 120 -14 8 7 $proofAmber

Draw-Bolt $c 30 28 54
Draw-Text $c "LIGHTNING" "Segoe UI" 44 $bold $proofPaper 88 26
Draw-Text $c "P2P" "Segoe UI" 44 $bold $signalGreen 340 26
Draw-Text $c "Direct peer-to-peer file transfer for Windows + Android" "Segoe UI" 14 $regular $proofPaper 92 84
Draw-Text $c "iroh QUIC transport  |  BLAKE3 verified  |  no cloud, no account" "Segoe UI" 12 $regular $dimGreen 92 106
Save-Art $c "wix-dialog"

Write-Host "installer art rendered into $outDir"
