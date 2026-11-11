# Makes the Microsoft Store tile and logo images for the MSIX package from
# the app icon (src-tauri\icons\icon.png, 512 x 512). Run it again only when
# the icon changes:  powershell -ExecutionPolicy Bypass -File msix\make-assets.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icon = [System.Drawing.Image]::FromFile((Join-Path $root "src-tauri\icons\icon.png"))
$out = Join-Path $PSScriptRoot "Assets"
New-Item -ItemType Directory -Force $out | Out-Null
# The steel blue of the icon, so the tiles look like one piece with it.
$teal = [System.Drawing.Color]::FromArgb(255, 0x1B, 0x3A, 0x5C)

# One PNG: w x h pixels. With $plate the image is filled with teal and the icon
# drawn at $share of the height; without, the icon fills it on transparency.
function Save-Png([string]$name, [int]$w, [int]$h, [bool]$plate, [double]$share) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    if ($plate) { $g.Clear($teal) } else { $g.Clear([System.Drawing.Color]::Transparent) }
    $s = [int][Math]::Round([Math]::Min($w, $h) * $share)
    $x = [int](($w - $s) / 2); $y = [int](($h - $s) / 2)
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $g.DrawImage($icon, (New-Object System.Drawing.Rectangle($x, $y, $s, $s)), 0, 0, $icon.Width, $icon.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose()
    $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$scales = @{ 100 = 1.0; 125 = 1.25; 150 = 1.5; 200 = 2.0; 400 = 4.0 }
foreach ($k in $scales.Keys) {
    $f = $scales[$k]
    # App list and taskbar icon: the icon itself (it has its own rounded plate).
    Save-Png "Square44x44Logo.scale-$k.png" ([int](44 * $f)) ([int](44 * $f)) $false 1.0
    Save-Png "StoreLogo.scale-$k.png" ([int](50 * $f)) ([int](50 * $f)) $false 1.0
    Save-Png "Square71x71Logo.scale-$k.png" ([int](71 * $f)) ([int](71 * $f)) $true 0.72
    Save-Png "Square150x150Logo.scale-$k.png" ([int](150 * $f)) ([int](150 * $f)) $true 0.62
    Save-Png "Wide310x150Logo.scale-$k.png" ([int](310 * $f)) ([int](150 * $f)) $true 0.72
    Save-Png "Square310x310Logo.scale-$k.png" ([int](310 * $f)) ([int](310 * $f)) $true 0.55
}
# Exact sizes Windows asks for in the taskbar, Start and Explorer.
foreach ($t in 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256) {
    Save-Png "Square44x44Logo.targetsize-$t.png" $t $t $false 1.0
    Save-Png "Square44x44Logo.targetsize-${t}_altform-unplated.png" $t $t $false 1.0
    Save-Png "Square44x44Logo.targetsize-${t}_altform-lightunplated.png" $t $t $false 1.0
}
$icon.Dispose()
"Made $((Get-ChildItem $out -Filter *.png).Count) images in $out"
