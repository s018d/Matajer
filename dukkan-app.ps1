Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$PROJECT = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NODE) { $NODE = "C:\Program Files\nodejs\node.exe" }

# ── الألوان ──
$BG       = [System.Drawing.Color]::FromArgb(18,18,24)
$PANEL    = [System.Drawing.Color]::FromArgb(28,28,38)
$GOLD     = [System.Drawing.Color]::FromArgb(212,175,55)
$GOLD_D   = [System.Drawing.Color]::FromArgb(180,148,40)
$GREEN    = [System.Drawing.Color]::FromArgb(46,204,113)
$RED      = [System.Drawing.Color]::FromArgb(231,76,60)
$TXT      = [System.Drawing.Color]::FromArgb(220,220,225)
$TXT2     = [System.Drawing.Color]::FromArgb(140,140,150)
$INPUT_BG = [System.Drawing.Color]::FromArgb(38,38,50)

# ── النافذة الرئيسية ──
$form = New-Object System.Windows.Forms.Form
$form.Text = "دُكّان — لوحة التحكم"
$form.Size = New-Object System.Drawing.Size(460, 520)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = $BG
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.TopMost = $false
$form.ShowInTaskbar = $true

# ── أيقونة System Tray ──
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Application
$tray.Text = "دُكّان — منصة المتاجر"
$tray.Visible = $false
$trayContextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$trayShow = $trayContextMenu.Items.Add("إظهار")
$trayShow.Add_Click({ $form.Show(); $form.WindowState = "Normal"; $form.BringToFront() })
$trayStart = $trayContextMenu.Items.Add("تشغيل السيرفر")
$trayStart.Add_Click({ Start-Server })
$trayStop = $trayContextMenu.Items.Add("إيقاف السيرفر")
$trayStop.Add_Click({ Stop-Server })
$trayExit = $trayContextMenu.Items.Add("خروج")
$trayExit.Add_Click({ Stop-Server; $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $trayContextMenu
$tray.Add_DoubleClick({ $form.Show(); $form.WindowState = "Normal"; $form.BringToFront() })

# ── الحالة ──
$script:serverProc = $null
$script:serverRunning = $false
$script:tunnelProc = $null

# ── العنوان ──
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "دُكّان"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $GOLD
$lblTitle.AutoSize = $true
$lblTitle.Location = New-Object System.Drawing.Point(170, 15)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "منصة المتاجر العراقية"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$lblSub.ForeColor = $TXT2
$lblSub.AutoSize = $true
$lblSub.Location = New-Object System.Drawing.Point(155, 55)
$form.Controls.Add($lblSub)

# ── קו فاصل ──
$line = New-Object System.Windows.Forms.Label
$line.BorderStyle = "Fixed3D"
$line.Size = New-Object System.Drawing.Size(400, 2)
$line.Location = New-Object System.Drawing.Point(20, 80)
$form.Controls.Add($line)

# ── البورت ──
$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = "البورت:"
$lblPort.ForeColor = $TXT
$lblPort.AutoSize = $true
$lblPort.Location = New-Object System.Drawing.Point(330, 95)
$form.Controls.Add($lblPort)

$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Text = "3000"
$txtPort.Size = New-Object System.Drawing.Size(80, 28)
$txtPort.Location = New-Object System.Drawing.Point(240, 92)
$txtPort.BackColor = $INPUT_BG
$txtPort.ForeColor = $TXT
$txtPort.BorderStyle = "FixedSingle"
$txtPort.TextAlign = "Center"
$txtPort.Font = New-Object System.Drawing.Font("Consolas", 11)
$form.Controls.Add($txtPort)

# ── زر التشغيل ──
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "▶  تشغيل السيرفر"
$btnStart.Size = New-Object System.Drawing.Size(190, 50)
$btnStart.Location = New-Object System.Drawing.Point(220, 135)
$btnStart.BackColor = $GREEN
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.FlatStyle = "Flat"
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$btnStart.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnStart.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnStart)

# ── زر الإيقاف ──
$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "⏹  إيقاف السيرفر"
$btnStop.Size = New-Object System.Drawing.Size(190, 50)
$btnStop.Location = New-Object System.Drawing.Point(20, 135)
$btnStop.BackColor = $RED
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = "Flat"
$btnStop.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$btnStop.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.Enabled = $false
$form.Controls.Add($btnStop)

# ── مؤشر الحالة ──
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "● متوقف"
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$lblStatus.ForeColor = $RED
$lblStatus.AutoSize = $true
$lblStatus.Location = New-Object System.Drawing.Point(175, 200)
$form.Controls.Add($lblStatus)

# ── الرابط ──
$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = ""
$lblUrl.Font = New-Object System.Drawing.Font("Consolas", 11)
$lblUrl.ForeColor = $GOLD
$lblUrl.AutoSize = $true
$lblUrl.Location = New-Object System.Drawing.Point(110, 228)
$form.Controls.Add($lblUrl)

# ── زر فتح المتصفح ──
$btnBrowser = New-Object System.Windows.Forms.Button
$btnBrowser.Text = "🌐 فتح في المتصفح"
$btnBrowser.Size = New-Object System.Drawing.Size(380, 40)
$btnBrowser.Location = New-Object System.Drawing.Point(30, 260)
$btnBrowser.BackColor = $PANEL
$btnBrowser.ForeColor = $GOLD
$btnBrowser.FlatStyle = "Flat"
$btnBrowser.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$btnBrowser.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnBrowser.FlatAppearance.BorderColor = $GOLD
$btnBrowser.FlatAppearance.BorderSize = 1
$btnBrowser.Enabled = $false
$form.Controls.Add($btnBrowser)

# ── اللوغ ──
$lblLogTitle = New-Object System.Windows.Forms.Label
$lblLogTitle.Text = "━━━ سجل الأحداث ━━━"
$lblLogTitle.ForeColor = $TXT2
$lblLogTitle.AutoSize = $true
$lblLogTitle.Location = New-Object System.Drawing.Point(135, 310)
$form.Controls.Add($lblLogTitle)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.Size = New-Object System.Drawing.Size(390, 100)
$txtLog.Location = New-Object System.Drawing.Point(30, 335)
$txtLog.BackColor = $INPUT_BG
$txtLog.ForeColor = $TXT2
$txtLog.BorderStyle = "FixedSingle"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 9)
$form.Controls.Add($txtLog)

# ── أزرار سريعة ──
$lblQuick = New-Object System.Windows.Forms.Label
$lblQuick.Text = "روابط سريعة:"
$lblQuick.ForeColor = $TXT2
$lblQuick.AutoSize = $true
$lblQuick.Location = New-Object System.Drawing.Point(330, 445)
$form.Controls.Add($lblQuick)

$linkLanding = New-Object System.Windows.Forms.LinkLabel
$linkLanding.Text = "الرئيسية"
$linkLanding.AutoSize = $true
$linkLanding.Location = New-Object System.Drawing.Point(270, 445)
$linkLanding.LinkColor = $GOLD
$linkLanding.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($linkLanding)

$linkAdmin = New-Object System.Windows.Forms.LinkLabel
$linkAdmin.Text = "لوحة المدير"
$linkAdmin.AutoSize = $true
$linkAdmin.Location = New-Object System.Drawing.Point(195, 445)
$linkAdmin.LinkColor = $GOLD
$linkAdmin.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($linkAdmin)

$linkPanel = New-Object System.Windows.Forms.LinkLabel
$linkPanel.Text = "لوحة التاجر"
$linkPanel.AutoSize = $true
$linkPanel.Location = New-Object System.Drawing.Point(105, 445)
$linkPanel.LinkColor = $GOLD
$linkPanel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($linkPanel)

# ── الدوال ──
function Add-Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    $txtLog.AppendText("[$ts] $msg`r`n")
}

function Start-Server {
    if ($script:serverRunning) { return }
    $port = $txtPort.Text.Trim()
    if (-not ($port -match '^\d+$')) { Add-Log "بورت غير صالح"; return }

    Add-Log "جاري تشغيل السيرفر على البورت $port ..."
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NODE
    $psi.Arguments = "server.js"
    $psi.WorkingDirectory = $PROJECT
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $script:serverProc = [System.Diagnostics.Process]::Start($psi)

    # قراءة المخرجات في الخلفية
    $job = {
        param($proc, $logBox)
        try {
            while (!$proc.HasExited) {
                $line = $proc.StandardOutput.ReadLine()
                if ($line) { $logBox.AppendText("[$( Get-Date -Format 'HH:mm:ss')] $line`r`n") }
            }
            $err = $proc.StandardError.ReadToEnd()
            if ($err) { $logBox.AppendText("[$( Get-Date -Format 'HH:mm:ss')] ERROR: $err`r`n") }
        } catch {}
    }
    $runspace = [runspacefactory]::CreateRunspace()
    $runspace.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $runspace
    $ps.AddScript($job).AddArgument($script:serverProc).AddArgument($txtLog) | Out-Null
    $ps.BeginInvoke() | Out-Null

    # انتظار 3 ثواني للتحقق
    Start-Sleep -Seconds 3
    if (-not $script:serverProc.HasExited) {
        $script:serverRunning = $true
        $lblStatus.Text = "● يعمل على البورت $port"
        $lblStatus.ForeColor = $GREEN
        $lblUrl.Text = "http://localhost:$port"
        $btnStart.Enabled = $false
        $btnStop.Enabled = $true
        $btnBrowser.Enabled = $true
        $tray.Visible = $true
        $tray.Text = "دُكّان — يعمل على $port"
        Add-Log "السيرفر يعمل بنجاح ✅"

        # فتح المتصفح تلقائياً
        Start-Process "http://localhost:$port"
    } else {
        $script:serverRunning = $false
        $lblStatus.Text = "● خطأ في التشغيل"
        $lblStatus.ForeColor = $RED
        Add-Log "فشل تشغيل السيرفر — تحقق من الكونسول"
    }
}

function Stop-Server {
    if ($script:serverProc -and -not $script:serverProc.HasExited) {
        try { $script:serverProc.Kill(); $script:serverProc.WaitForExit(2000) } catch {}
        Add-Log "تم إيقاف السيرفر"
    }
    # إيقاف أي عمليات node متبقية على نفس البورت
    $port = $txtPort.Text.Trim()
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Id -ne $script:serverProc.Id } catch { $true }
    } | Stop-Process -Force -ErrorAction SilentlyContinue

    $script:serverRunning = $false
    $script:serverProc = $null
    $lblStatus.Text = "● متوقف"
    $lblStatus.ForeColor = $RED
    $lblUrl.Text = ""
    $btnStart.Enabled = $true
    $btnStop.Enabled = $false
    $btnBrowser.Enabled = $false
    Add-Log "تم الإيقاف"
}

function Open-Browser($url) {
    Start-Process $url
}

# ── أحداث الأزرار ──
$btnStart.Add_Click({ Start-Server })
$btnStop.Add_Click({ Stop-Server })
$btnBrowser.Add_Click({ Open-Browser $lblUrl.Text })

$linkLanding.Add_LinkClicked({ param($s,$e) Open-Browser "http://localhost:$($txtPort.Text)" })
$linkAdmin.Add_LinkClicked({ param($s,$e) Open-Browser "http://localhost:$($txtPort.Text)/admin" })
$linkPanel.Add_LinkClicked({ param($s,$e) Open-Browser "http://localhost:$($txtPort.Text)/panel" })

# ── تصغير للـ Tray ──
$form.Add_FormClosing({
    param($s,$e)
    if ($script:serverRunning) {
        $tray.Visible = $true
        $tray.ShowBalloonTip(2000, "دُكّان", "السيرفر يعمل في الخلفية", "Info")
        $e.Cancel = $true
        $form.Hide()
    }
})

# ── تشغيل ──
Add-Log "دُكّان — جاهز للتشغيل"
Add-Log "اضغط ▶ لتشغيل السيرفر"
[System.Windows.Forms.Application]::Run($form)
