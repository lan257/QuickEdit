# 数据驱动的流程图渲染器：按 GB/T 1526（ISO 5807）符号绘制，输出高清 PNG。
# 用法: powershell -File render.ps1 -Spec spec.json -Out out目录
param(
  [Parameter(Mandatory = $true)][string]$Spec,
  [Parameter(Mandatory = $true)][string]$Out,
  [switch]$Check
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }

$specObj = Get-Content $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
$scratch = New-Object System.Drawing.Bitmap 8, 8
$mg = [System.Drawing.Graphics]::FromImage($scratch)   # 仅用于量取文本尺寸
$sc = 2                       # 超采样倍数
$cellW = 230; $cellH = 120; $originX = 90; $originY = 90

$colInk = [System.Drawing.Color]::FromArgb(31, 59, 99)
$colInkSoft = [System.Drawing.Color]::FromArgb(96, 110, 130)
$colText = [System.Drawing.Color]::FromArgb(28, 40, 58)
$colWhite = [System.Drawing.Color]::White
$colProcess = [System.Drawing.Color]::White
$colTerminal = [System.Drawing.Color]::FromArgb(232, 240, 251)
$colDecision = [System.Drawing.Color]::FromArgb(255, 246, 224)
$colIo = [System.Drawing.Color]::FromArgb(234, 243, 255)
$colDoc = [System.Drawing.Color]::FromArgb(240, 248, 240)
$colStore = [System.Drawing.Color]::FromArgb(238, 241, 246)
$colGroup = [System.Drawing.Color]::FromArgb(247, 249, 252)
$colComment = [System.Drawing.Color]::FromArgb(255, 251, 228)
$colGroupLine = [System.Drawing.Color]::FromArgb(175, 190, 205)
$colCaption = [System.Drawing.Color]::FromArgb(20, 32, 48)

function PF($x, $y) { return New-Object System.Drawing.PointF([single]$x, [single]$y) }
function RC($x, $y, $w, $h) { return New-Object System.Drawing.RectangleF([single]$x, [single]$y, [single]$w, [single]$h) }
function PEN($color, $width) { $p = New-Object System.Drawing.Pen($color, [single]$width); $p.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round; return $p }
function BRUSH($color) { return New-Object System.Drawing.SolidBrush($color) }
function NFT($family, $size, $bold) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font($family, [single]($size * $sc), $style)
}

function Box-Of($n) {
  $w = if ($n.w) { [double]$n.w } else { 176 }
  $nominal = if ($n.h) { [double]$n.h } else { 58 }
  $h = [math]::Max($nominal, (Fit-Height $n $w))
  $pw = $w * $sc; $ph = $h * $sc
  $cx = ($originX + [double]$n.col * $cellW) * $sc
  $cy = ($originY + [double]$n.row * $cellH) * $sc
  return RC ($cx - $pw / 2) ($cy - $ph / 2) $pw $ph
}

function Fit-Height($n, $w) {
  $size = if ($n.fs) { [double]$n.fs } else { 12 }
  $f1 = NFT "Microsoft YaHei" $size $true
  $f2 = NFT "Microsoft YaHei" ($size - 1.5) $false
  $mw = $w * $sc - 20 * $sc
  if ($n.shape -eq "class") {
    $cl = @($n.lines)
    $w1 = Wrap-Text ([string]$cl[0]) $f1 $mg $mw
    $n1 = @($w1).Count
    $n2 = 0
    foreach ($row in ($cl | Select-Object -Skip 1)) {
      $w2 = Wrap-Text ([string]$row) $f2 $mg $mw
      $n2 = $n2 + @($w2).Count
    }
    $head = (4 * $sc + $n1 * $f1.GetHeight($mg) * 0.85) / 0.29
    $body = (3 * $sc + $n2 * $f2.GetHeight($mg) * 0.8) / 0.71
    return ([math]::Max($head, $body) + 6 * $sc) / $sc
  }
  if ($n.shape -eq "actor" -or $n.shape -eq "frame" -or $n.shape -eq "connector") { return 0 }
  $w1 = Wrap-Text ([string]$n.label) $f1 $mg $mw
  $n1 = @($w1).Count
  $n2 = 0
  if ($n.sub) {
    $w2 = Wrap-Text ([string]$n.sub) $f2 $mg $mw
    $n2 = @($w2).Count
  }
  return ($n1 * $f1.GetHeight($mg) * 0.92 + $n2 * $f2.GetHeight($mg) * 0.92 + 14 * $sc) / $sc
}

function Anchor($r, $side) {
  if ($side -eq "t") { return PF ($r.X + $r.Width / 2) $r.Y }
  if ($side -eq "l") { return PF $r.X ($r.Y + $r.Height / 2) }
  if ($side -eq "r") { return PF ($r.X + $r.Width) ($r.Y + $r.Height / 2) }
  if ($side -eq "c") { return PF ($r.X + $r.Width / 2) ($r.Y + $r.Height / 2) }
  return PF ($r.X + $r.Width / 2) ($r.Y + $r.Height)
}

function Draw-Shape($g, $n, $r) {
  $shape = if ($n.shape) { $n.shape } else { "process" }
  $fill = $colProcess
  if ($shape -eq "terminal") { $fill = $colTerminal }
  if ($shape -eq "decision") { $fill = $colDecision }
  if ($shape -eq "io") { $fill = $colIo }
  if ($shape -eq "doc") { $fill = $colDoc }
  if ($shape -eq "store") { $fill = $colStore }
  if ($shape -eq "comment") { $fill = $colComment }
  if ($shape -eq "usecase") { $fill = $colTerminal }
  $pen = PEN $colInk 2.2
  $fb = BRUSH $fill
  $x = $r.X; $y = $r.Y; $w = $r.Width; $h = $r.Height

  if ($shape -eq "terminal") {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $h, $h, 90, 180)
    $path.AddArc(($x + $w - $h), $y, $h, $h, 270, 180)
    $path.CloseFigure()
    $g.FillPath($fb, $path); $g.DrawPath($pen, $path)
  } elseif ($shape -eq "decision") {
    $mx = $x + $w / 2; $cy = $y + $h / 2
    $pts = [System.Drawing.PointF[]] @((PF $mx $y), (PF ($x + $w) $cy), (PF $mx ($y + $h)), (PF $x $cy))
    $g.FillPolygon($fb, $pts); $g.DrawPolygon($pen, $pts)
  } elseif ($shape -eq "io") {
    $s = $w * 0.13
    $pts = [System.Drawing.PointF[]] @((PF ($x + $s) $y), (PF ($x + $w) $y), (PF ($x + $w - $s) ($y + $h)), (PF $x ($y + $h)))
    $g.FillPolygon($fb, $pts); $g.DrawPolygon($pen, $pts)
  } elseif ($shape -eq "doc") {
    $body = $h - $h * 0.16
    $g.FillRectangle($fb, $x, $y, $w, $body)
    $g.DrawRectangle($pen, $x, $y, $w, $body)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $top = $y + $body
    $path.AddBezier($x, $top, ($x + $w * 0.33), ($y + $h + $h * 0.14), ($x + $w * 0.66), ($top - $h * 0.14), ($x + $w), ($y + $h))
    $g.DrawPath($pen, $path)
  } elseif ($shape -eq "store") {
    $eh = $h * 0.28
    $g.FillRectangle($fb, $x, ($y + $eh / 2), $w, ($h - $eh))
    $g.DrawArc($pen, $x, ($y + $h - $eh), $w, $eh, 0, 180)
    $g.DrawLine($pen, $x, ($y + $eh / 2), $x, ($y + $h - $eh / 2))
    $g.DrawLine($pen, ($x + $w), ($y + $eh / 2), ($x + $w), ($y + $h - $eh / 2))
    $g.DrawArc($pen, $x, $y, $w, $eh, 0, 360)
  } elseif ($shape -eq "predefined") {
    $g.FillRectangle($fb, $x, $y, $w, $h)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
    $b = $w * 0.055
    $g.DrawLine($pen, ($x + $b), $y, ($x + $b), ($y + $h))
    $g.DrawLine($pen, ($x + $w - $b), $y, ($x + $w - $b), ($y + $h))
  } elseif ($shape -eq "frame") {
    $g.FillRectangle((BRUSH $colGroup), $x, $y, $w, $h)
    $g.DrawRectangle((PEN $colInk 2.2), $x, $y, $w, $h)
  } elseif ($shape -eq "connector") {
    $d = [math]::Min($w, $h)
    $g.FillEllipse($fb, ($x + ($w - $d) / 2), ($y + ($h - $d) / 2), $d, $d)
    $g.DrawEllipse($pen, ($x + ($w - $d) / 2), ($y + ($h - $d) / 2), $d, $d)
  } elseif ($shape -eq "usecase") {
    $g.FillEllipse($fb, $x, $y, $w, $h)
    $g.DrawEllipse($pen, $x, $y, $w, $h)
  } elseif ($shape -eq "actor") {
    $head = $h * 0.22
    $cx = $x + $w / 2
    $g.DrawEllipse($pen, ($cx - $head / 2), $y, $head, $head)
    $neck = $y + $head
    $g.DrawLine($pen, $cx, $neck, $cx, ($neck + $h * 0.32))
    $g.DrawLine($pen, ($cx - $w * 0.2), ($neck + $h * 0.12), ($cx + $w * 0.2), ($neck + $h * 0.12))
    $g.DrawLine($pen, $cx, ($neck + $h * 0.32), ($cx - $w * 0.16), ($y + $h))
    $g.DrawLine($pen, $cx, ($neck + $h * 0.32), ($cx + $w * 0.16), ($y + $h))
  } elseif ($shape -eq "class") {
    $g.FillRectangle($fb, $x, $y, $w, $h)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
    $headH = $h * 0.26
    $g.DrawLine($pen, $x, ($y + $headH), ($x + $w), ($y + $headH))
  } elseif ($shape -eq "comment") {
    $g.FillRectangle($fb, $x, $y, $w, $h)
    $pd = PEN $colInkSoft 1.8
    $pd.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot
    $g.DrawRectangle($pd, $x, $y, $w, $h)
  } else {
    $g.FillRectangle($fb, $x, $y, $w, $h)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
  }
}

function Wrap-Text($text, $font, $g, $maxWidth) {
  $lines = @()
  foreach ($para in ($text -split "\n")) {
    $cur = ""
    foreach ($tok in [regex]::Matches([string]$para, '[A-Za-z0-9_~()/\-:%]+\.|[^A-Za-z0-9_~()/\-.:]|.')) {
      $ch = $tok.Value
      if ($ch -eq " " -and $cur -eq "") { continue }
      $test = $cur + $ch
      if ($cur -ne "" -and $g.MeasureString($test, $font).Width -gt $maxWidth) {
        $lines += $cur.TrimEnd()
        $cur = if ($ch -eq " ") { "" } else { $ch }
      } elseif ($cur -eq "" -and $ch.Length -gt 1 -and $g.MeasureString($ch, $font).Width -gt $maxWidth) {
        $acc = ""
        foreach ($hc in [char[]]$ch) {
          if ($acc -ne "" -and $g.MeasureString($acc + $hc, $font).Width -gt $maxWidth) { $lines += $acc; $acc = "$hc" } else { $acc = $acc + $hc }
        }
        $cur = $acc
      } else { $cur = $test }
    }
    $lines += $cur.TrimEnd()
  }
  return ,$lines
}

function Draw-NodeText($g, $n, $r) {
  $shape = if ($n.shape) { $n.shape } else { "process" }
  $size = if ($n.fs) { [double]$n.fs } else { 12 }
  $brush = BRUSH $colText
  $maxWidth = $r.Width - 20 * $sc
  if ($shape -eq "actor") { $maxWidth = 150 * $sc }

  if ($shape -eq "frame") {
    $f = NFT "Microsoft YaHei" $size $true
    $tw = $g.MeasureString([string]$n.label, $f).Width
    $g.DrawString([string]$n.label, $f, $brush, ($r.X + ($r.Width - $tw) / 2), ($r.Y + 9 * $sc))
    return
  }

  if ($shape -eq "class") {
    $lines = @($n.lines)
    $head = NFT "Microsoft YaHei" $size $true
    $body = NFT "Microsoft YaHei" ($size - 1.5) $false
    $y = $r.Y + 4 * $sc
    foreach ($l in (Wrap-Text ([string]$lines[0]) $head $g $maxWidth)) {
      $g.DrawString($l, $head, $brush, ($r.X + 8 * $sc), $y)
      $y = $y + $head.GetHeight($g) * 0.85
    }
    $y = $r.Y + $r.Height * 0.29 + 3 * $sc
    foreach ($row in ($lines | Select-Object -Skip 1)) {
      foreach ($l in (Wrap-Text ([string]$row) $body $g $maxWidth)) {
        $g.DrawString($l, $body, $brush, ($r.X + 8 * $sc), $y)
        $y = $y + $body.GetHeight($g) * 0.8
      }
    }
    return
  }

  $f1 = NFT "Microsoft YaHei" $size $true
  $f2 = NFT "Microsoft YaHei" ($size - 1.5) $false
  $l1 = Wrap-Text ([string]$n.label) $f1 $g $maxWidth
  $l2 = @()
  if ($n.sub) { $l2 = Wrap-Text ([string]$n.sub) $f2 $g $maxWidth }
  $lh1 = $f1.GetHeight($g) * 0.92
  $lh2 = $f2.GetHeight($g) * 0.92
  $total = $l1.Count * $lh1 + $l2.Count * $lh2
  $cy = $r.Y + ($r.Height - $total) / 2
  if ($shape -eq "actor") { $cy = $r.Y + $r.Height + 4 * $sc }
  foreach ($l in $l1) {
    $tw = $g.MeasureString($l, $f1).Width
    $g.DrawString($l, $f1, $brush, ($r.X + ($r.Width - $tw) / 2), $cy)
    $cy = $cy + $lh1
  }
  foreach ($l in $l2) {
    $tw = $g.MeasureString($l, $f2).Width
    $g.DrawString($l, $f2, $brush, ($r.X + ($r.Width - $tw) / 2), $cy)
    $cy = $cy + $lh2
  }
}

function Draw-Edge($g, $a, $b, $edge) {
  $fromSide = if ($edge.fromSide) { $edge.fromSide } else { "b" }
  $toSide = if ($edge.toSide) { $edge.toSide } else { "t" }
  $p0 = Anchor $a $fromSide
  $p1 = Anchor $b $toSide
  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  $pts.Add($p0)

  if ($edge.straight) {
    # 直连（用例关联、类图关联）：不加折点
  } elseif ($edge.via) {
    $flat = @($edge.via)
    for ($vi = 0; $vi -lt $flat.Count; $vi += 2) {
      $pts.Add((PF ([double]$flat[$vi] * $sc) ([double]$flat[($vi + 1)] * $sc)))
    }
  } elseif ($fromSide -eq "b" -and $toSide -eq "t") {
    if ([math]::Abs($p0.X - $p1.X) -gt 2) {
      $mid = ($p0.Y + $p1.Y) / 2
      $pts.Add((PF $p0.X $mid)); $pts.Add((PF $p1.X $mid))
    }
  } elseif ($fromSide -eq "r" -and $toSide -eq "l") {
    if ([math]::Abs($p0.Y - $p1.Y) -gt 2) {
      $mid = ($p0.X + $p1.X) / 2
      $pts.Add((PF $mid $p0.Y)); $pts.Add((PF $mid $p1.Y))
    }
  } elseif ($fromSide -eq "b" -and ($toSide -eq "l" -or $toSide -eq "r")) {
    $pts.Add((PF $p0.X $p1.Y))
  } elseif (($fromSide -eq "r" -or $fromSide -eq "l") -and $toSide -eq "t") {
    $pts.Add((PF $p1.X $p0.Y))
  } elseif ($fromSide -eq "r" -and $toSide -eq "r") {
    $far = [math]::Max($p0.X, $p1.X) + 30 * $sc
    $pts.Add((PF $far $p0.Y)); $pts.Add((PF $far $p1.Y))
  } elseif ($fromSide -eq "l" -and $toSide -eq "l") {
    $far = [math]::Min($p0.X, $p1.X) - 30 * $sc
    $pts.Add((PF $far $p0.Y)); $pts.Add((PF $far $p1.Y))
  }
  $pts.Add($p1)
  $script:edgePts = $pts

  $style = if ($edge.style) { $edge.style } else { "solid" }
  $width = if ($style -eq "dashed") { 1.8 } else { 2.1 }
  $color = if ($style -eq "dashed") { $colInkSoft } else { $colInk }
  $pen = PEN $color $width
  if ($style -eq "dashed") { $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash }
  for ($i = 0; $i -lt ($pts.Count - 1); $i++) { $g.DrawLine($pen, $pts[$i], $pts[($i + 1)]) }

  if ($style -ne "line") {
    $last = $pts[($pts.Count - 1)]
    $prev = $pts[($pts.Count - 2)]
    $angle = [math]::Atan2(($last.Y - $prev.Y), ($last.X - $prev.X))
    $len = 10 * $sc
    $bx = $last.X - $len * [math]::Cos($angle - 0.42)
    $by = $last.Y - $len * [math]::Sin($angle - 0.42)
    $cx2 = $last.X - $len * [math]::Cos($angle + 0.42)
    $cy2 = $last.Y - $len * [math]::Sin($angle + 0.42)
    $h1 = PF $last.X $last.Y
    $h2 = PF $bx $by
    $h3 = PF $cx2 $cy2
    $head = [System.Drawing.PointF[]] @($h1, $h2, $h3)
    $g.FillPolygon((BRUSH $color), $head)
  }

  if ($edge.label) {
    $font = NFT "Microsoft YaHei" 10.5 $false
    $m = $g.MeasureString([string]$edge.label, $font)
    if ($edge.labelPos) {
      $cx = [double]$edge.labelPos[0] * $sc
      $cy = [double]$edge.labelPos[1] * $sc
    } else {
      $i = [int][math]::Floor($pts.Count / 2)
      $cx = ($pts[($i - 1)].X + $pts[$i].X) / 2
      $cy = ($pts[($i - 1)].Y + $pts[$i].Y) / 2
    }
    if ($edge.labelDx) { $cx = $cx + [double]$edge.labelDx * $sc }
    if ($edge.labelDy) { $cy = $cy + [double]$edge.labelDy * $sc }
    $pad = 4 * $sc
    $bg = RC ($cx - $m.Width / 2 - $pad) ($cy - $m.Height / 2 - $pad / 2) ($m.Width + $pad * 2) ($m.Height + $pad)
    $g.FillRectangle((BRUSH $colWhite), $bg.X, $bg.Y, $bg.Width, $bg.Height)
    $g.DrawString([string]$edge.label, $font, (BRUSH $colInkSoft), ($cx - $m.Width / 2), ($cy - $m.Height / 2))
  }
}

function Draw-Legend($g, $shapes, $y) {
  if (-not $shapes) { return }
  $bold = NFT "Microsoft YaHei" 10.5 $true
  $font = NFT "Microsoft YaHei" 10 $false
  $brush = BRUSH $colText
  $head = "图例（符号依据 GB/T 1526 / ISO 5807）"
  $g.DrawString($head, $bold, $brush, ($originX * $sc), $y)
  $x = $originX * $sc + $g.MeasureString($head, $bold).Width + 14 * $sc
  foreach ($item in $shapes) {
    $mini = RC $x ($y + 1 * $sc) (40 * $sc) (20 * $sc)
    Draw-Shape $g @{ shape = $item.shape } $mini
    $x = $x + 48 * $sc
    $g.DrawString([string]$item.name, $font, $brush, $x, ($y + 3 * $sc))
    $x = $x + $g.MeasureString([string]$item.name, $font).Width + 22 * $sc
  }
}

function Seg-Hits-Rect($x0, $y0, $x1, $y1, $r) {
  $l = $r.X + 3; $t = $r.Y + 3; $rr = ($r.X + $r.Width - 3); $bb = ($r.Y + $r.Height - 3)
  if (([math]::Min($x0, $x1) -gt $rr) -or ([math]::Max($x0, $x1) -lt $l)) { return $false }
  if (([math]::Min($y0, $y1) -gt $bb) -or ([math]::Max($y0, $y1) -lt $t)) { return $false }
  $dx = $x1 - $x0; $dy = $y1 - $y0
  $t0 = 0.0; $t1 = 1.0
  $p = @((-$dx), $dx, (-$dy), $dy)
  $q = @(($x0 - $l), ($rr - $x0), ($y0 - $t), ($bb - $y0))
  for ($k = 0; $k -lt 4; $k++) {
    if ([math]::Abs($p[$k]) -lt 0.000001) { if ($q[$k] -lt 0) { return $false } }
    else {
      $ratio = $q[$k] / $p[$k]
      if ($p[$k] -lt 0) { if ($ratio -gt $t1) { return $false }; if ($ratio -gt $t0) { $t0 = $ratio } }
      else { if ($ratio -lt $t0) { return $false }; if ($ratio -lt $t1) { $t1 = $ratio } }
    }
  }
  return ($t1 -gt ($t0 + 0.001))
}

foreach ($fig in $specObj.figures) {
  if ($fig.groups) { $originX = 268 } else { $originX = 112 }
  if ($fig.gridW) { $script:cellW = [double]$fig.gridW } else { $script:cellW = 230 }
  $extra = if ($fig.extraRows) { [double]$fig.extraRows } else { 0 }

  $map = @{}
  foreach ($n in $fig.nodes) { $map[$n.id] = Box-Of $n }
  $minX = $null; $maxX = $null; $minY = $null; $maxY = $null
  foreach ($n in $fig.nodes) {
    $r = $map[$n.id]
    if ($null -eq $minX -or $r.X -lt $minX) { $minX = $r.X }
    if ($null -eq $maxX -or ($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
    if ($null -eq $minY -or $r.Y -lt $minY) { $minY = $r.Y }
    if ($null -eq $maxY -or ($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
  }
  if (($minY / $sc) -lt 44) {
    $originY = $originY + 44 - ($minY / $sc)
    $map = @{}
    foreach ($n in $fig.nodes) { $map[$n.id] = Box-Of $n }
    $minY = $null; $maxY = $null
    foreach ($n in $fig.nodes) {
      $r = $map[$n.id]
      if ($null -eq $minY -or $r.Y -lt $minY) { $minY = $r.Y }
      if ($null -eq $maxY -or ($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
    }
  }
  if (($minX / $sc) -lt 24) {
    $originX = $originX + 24 - ($minX / $sc)
    $map = @{}
    foreach ($n in $fig.nodes) { $map[$n.id] = Box-Of $n }
    $minX = $null; $maxX = $null
    foreach ($n in $fig.nodes) {
      $r = $map[$n.id]
      if ($null -eq $minX -or $r.X -lt $minX) { $minX = $r.X }
      if ($null -eq $maxX -or ($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
    }
  }
  $width = ($maxX / $sc) + 72
  $height = ($maxY / $sc) + 58 + 76 + $extra * $cellH

  $bmp = New-Object System.Drawing.Bitmap ([int]($width * $sc)), ([int]($height * $sc))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::White)

  $bandFont = NFT "Microsoft YaHei" 11 $true
  $bandBrush = BRUSH $colInk
  foreach ($grp in $fig.groups) {
    $by0 = $null; $by1 = $null
    foreach ($n in $fig.nodes) {
      if ([double]$n.row -lt [double]$grp.row0 -or [double]$n.row -gt [double]$grp.row1) { continue }
      $r = $map[$n.id]
      if ($null -eq $by0 -or $r.Y -lt $by0) { $by0 = $r.Y }
      if ($null -eq $by1 -or ($r.Y + $r.Height) -gt $by1) { $by1 = $r.Y + $r.Height }
    }
    $bx0 = 22 * $sc; $bx1 = ($width - 22) * $sc
    $by0 = $by0 - 20 * $sc; $by1 = $by1 + 20 * $sc
    $rect = RC $bx0 $by0 ($bx1 - $bx0) ($by1 - $by0)
    $g.FillRectangle((BRUSH $colGroup), $rect.X, $rect.Y, $rect.Width, $rect.Height)
    $g.DrawRectangle((PEN $colGroupLine 1.6), $rect.X, $rect.Y, $rect.Width, $rect.Height)
    $g.DrawLine((PEN $colGroupLine 1.6), $bx0, ($by0 + 30 * $sc), $bx1, ($by0 + 30 * $sc))
    if ($grp.label) {
      $labMax = $minX - $bx0 - 18 * $sc
      $labLines = Wrap-Text ([string]$grp.label) $bandFont $g $labMax
      $lh = $g.MeasureString("Ag", $bandFont).Height + 2
      $ly = $by0 + 30 * $sc + (($by1 - $by0 - 30 * $sc) - $lh * $labLines.Count) / 2
      foreach ($ll in $labLines) { $g.DrawString([string]$ll, $bandFont, $bandBrush, ($bx0 + 14 * $sc), $ly); $ly = $ly + $lh }
    }
  }

  foreach ($n in $fig.nodes) {
    if ($n.shape -eq "frame") { Draw-Shape $g $n $map[$n.id]; Draw-NodeText $g $n $map[$n.id] }
  }
  foreach ($e in $fig.edges) { Draw-Edge $g $map[$e.from] $map[$e.to] $e }
  foreach ($n in $fig.nodes) {
    if ($n.shape -eq "frame") { continue }
    Draw-Shape $g $n $map[$n.id]; Draw-NodeText $g $n $map[$n.id]
  }

  if ($Check) {
    $issues = @()
    $arr = @($fig.nodes)
    for ($i = 0; $i -lt $arr.Count; $i++) {
      $n = $arr[$i]; $r = $map[$n.id]
      if (-not $r) { $issues += ("missing node box {0}" -f $n.id); continue }
      $nominal = if ($n.h) { [double]$n.h } else { 58 }
      $skip = @("class", "frame", "comment", "actor", "connector", "usecase") -contains [string]$n.shape
      if (-not $skip -and ($r.Height / $sc) -gt ($nominal * 1.3)) {
        $issues += ("tall {0}: label needs {1}px, nominal {2}px — 建议缩短文案或加宽节点" -f $n.id, [int]($r.Height / $sc), [int]$nominal)
      }
      for ($j = $i + 1; $j -lt $arr.Count; $j++) {
        $b = $map[$arr[$j].id]
        if ($n.shape -eq "frame" -or $arr[$j].shape -eq "frame") { continue }
        if ($r.X -lt ($b.X + $b.Width) -and $b.X -lt ($r.X + $r.Width) -and $r.Y -lt ($b.Y + $b.Height) -and $b.Y -lt ($r.Y + $r.Height)) {
          $issues += ("overlap {0} x {1}" -f $n.id, $arr[$j].id)
        }
      }
    }
    foreach ($e in $fig.edges) {
      if (-not $map[$e.from] -or -not $map[$e.to]) { $issues += ("bad edge end {0}->{1}" -f $e.from, $e.to); continue }
      Draw-Edge $g $map[$e.from] $map[$e.to] $e
      $pl = $script:edgePts
      for ($k = 0; $k -lt ($pl.Count - 1); $k++) {
        foreach ($n in $arr) {
          if ($n.id -eq $e.from -or $n.id -eq $e.to -or $n.shape -eq "frame") { continue }
          if (Seg-Hits-Rect $pl[$k].X $pl[$k].Y $pl[($k + 1)].X $pl[($k + 1)].Y $map[$n.id]) {
            $issues += ("cross {0}->{1} over {2}" -f $e.from, $e.to, $n.id)
          }
        }
      }
      foreach ($p in $pl) {
        if ($p.X -lt 0 -or $p.Y -lt 0 -or $p.X -gt ($width * $sc) -or $p.Y -gt (($height - 120) * $sc)) {
          $issues += ("offcanvas {0}->{1}" -f $e.from, $e.to)
        }
      }
    }
    if ($issues.Count -gt 0) { Write-Output ("== {0}" -f $fig.file); $issues | ForEach-Object { Write-Output ("   " + $_) } }
    $g.Dispose(); $bmp.Dispose()
    continue
  }

  Draw-Legend $g $fig.legend (($height - 52) * $sc)
  $cf = NFT "Microsoft YaHei" 12.5 $true
  $cap = [string]$fig.caption
  $cw = $g.MeasureString($cap, $cf).Width
  $g.DrawString($cap, $cf, (BRUSH $colCaption), ($width * $sc - $cw) / 2, (($height - 28) * $sc))
  $g.Dispose()
  $target = Join-Path $Out $fig.file
  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("rendered {0}  {1}x{2}px" -f $fig.file, [int]$width, [int]$height)
}
