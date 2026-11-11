using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

sealed class ShopeeClipLauncher : Form
{
    static readonly Color Ink = Color.FromArgb(255, 243, 233);
    static readonly Color Orange = Color.FromArgb(255, 126, 84);
    static readonly Color Chrome = Color.FromArgb(29, 23, 34);
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly HttpClient client = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(2) };
    readonly Timer timer = new Timer { Interval = 1200 };
    readonly Timer introTimer = new Timer { Interval = 16 };
    readonly Label status = new Label();
    readonly Button open = new Button();
    readonly Button stop = new Button();
    readonly Button minimize = new Button();
    readonly Button close = new Button();
    IntroSurface intro;
    bool busy;
    bool online;
    bool stopping;
    string url;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

    [STAThread]
    static void Main()
    {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ShopeeClipLauncher());
    }

    ShopeeClipLauncher()
    {
        Text = "Shopee Clip V2";
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(LauncherArtwork.Width, LauncherArtwork.Height);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(11, 10, 16);
        DoubleBuffered = true;
        KeyPreview = true;
        url = LocalUrl();

        status.SetBounds(66, 254, 335, 51);
        status.ForeColor = Ink;
        status.BackColor = Color.Transparent;
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.Font = new Font("Leelawadee UI", 13);
        status.Text = "กำลังตรวจสถานะ";
        Controls.Add(status);
        Configure(open, "เปิดหน้าคิว", new Rectangle(44, 327, 211, 54), Orange, Color.FromArgb(36, 17, 14));
        Configure(stop, "ปิดระบบ", new Rectangle(269, 327, 142, 54), Chrome, Ink);
        Configure(minimize, "−", new Rectangle(698, 13, 42, 36), Chrome, Ink);
        Configure(close, "×", new Rectangle(746, 13, 42, 36), Chrome, Ink);
        minimize.AccessibleName = "ย่อหน้าต่าง";
        close.AccessibleName = "ปิดหน้าต่าง Launcher";
        minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
        close.Click += delegate { Close(); };
        MouseDown += delegate(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
        };
        open.Enabled = stop.Enabled = false;
        open.Click += async delegate { await OpenStudio(); };
        stop.Click += async delegate { await StopStudio(); };
        timer.Tick += async delegate { await RefreshStudio(); };
        AddIntro();
        Shown += async delegate {
            if (intro != null) { intro.Clock.Start(); introTimer.Start(); intro.Skip.Focus(); }
            timer.Start();
            await RefreshStudio();
        };
        FormClosed += delegate { introTimer.Dispose(); timer.Dispose(); client.Dispose(); };
    }

    static void StyleButton(Button button, string label, Rectangle bounds, Color background, Color foreground)
    {
        button.Text = label;
        button.Bounds = bounds;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = Color.FromArgb(103, 68, 71);
        button.FlatAppearance.MouseOverBackColor = ControlPaint.Light(background, .12f);
        button.BackColor = background;
        button.ForeColor = foreground;
        button.Font = new Font("Leelawadee UI", 11, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
    }

    void Configure(Button button, string label, Rectangle bounds, Color background, Color foreground)
    {
        StyleButton(button, label, bounds, background, foreground);
        Controls.Add(button);
    }

    void AddIntro()
    {
        intro = new IntroSurface { Dock = DockStyle.Fill };
        StyleButton(intro.Skip, "ข้ามอินโทร", new Rectangle(665, 397, 118, 39), Chrome, Ink);
        intro.Skip.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        intro.Skip.Click += delegate { EndIntro(); };
        intro.Size = ClientSize;
        intro.Controls.Add(intro.Skip);
        Controls.Add(intro);
        intro.BringToFront();
        open.TabStop = stop.TabStop = minimize.TabStop = close.TabStop = false;
        introTimer.Tick += delegate {
            if (intro.Clock.Elapsed.TotalSeconds >= LauncherArtwork.IntroDuration) EndIntro();
            else intro.Invalidate();
        };
        KeyDown += delegate(object sender, KeyEventArgs e) {
            if (intro == null || e.KeyCode != Keys.Escape) return;
            e.Handled = e.SuppressKeyPress = true;
            EndIntro();
        };
    }

    void EndIntro()
    {
        if (intro == null) return;
        introTimer.Stop();
        Controls.Remove(intro);
        intro.Dispose();
        intro = null;
        open.TabStop = stop.TabStop = minimize.TabStop = close.TabStop = true;
        (open.Enabled ? open : close).Focus();
    }

    sealed class IntroSurface : Panel
    {
        public readonly Stopwatch Clock = new Stopwatch();
        public readonly Button Skip = new Button();

        public IntroSurface()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var state = e.Graphics.Save();
            e.Graphics.ScaleTransform(ClientSize.Width / (float)LauncherArtwork.Width, ClientSize.Height / (float)LauncherArtwork.Height);
            LauncherArtwork.DrawIntro(e.Graphics, (float)Clock.Elapsed.TotalSeconds);
            e.Graphics.Restore(state);
        }
    }

    string LocalUrl()
    {
        string config = Path.Combine(root, "config.toml");
        Match match = File.Exists(config) ? Regex.Match(File.ReadAllText(config), @"(?m)^\s*port\s*=\s*(\d+)\s*(?:#.*)?$") : Match.Empty;
        return "http://127.0.0.1:" + (match.Success ? match.Groups[1].Value : "4317");
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        if (ClientSize.Width < 50 || ClientSize.Height < 50) return;
        using (var outline = LauncherArtwork.Rounded(ClientRectangle, ClientSize.Width / 40f))
            Region = new Region(outline);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        var state = e.Graphics.Save();
        e.Graphics.ScaleTransform(ClientSize.Width / (float)LauncherArtwork.Width, ClientSize.Height / (float)LauncherArtwork.Height);
        LauncherArtwork.DrawDashboard(e.Graphics, online, stopping);
        e.Graphics.Restore(state);
    }

    async Task<bool> ReadStatus()
    {
        try
        {
            string response = await client.GetStringAsync(url + "/api/status");
            if (!response.Contains("\"app\":\"shopee-clip\"")) return false;
            stopping = response.Contains("\"stopping\":true");
            return true;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) { return false; }
        catch (ObjectDisposedException) { return false; }
    }

    void UpdateControls()
    {
        open.Text = online ? "เปิดหน้าคิว" : "เริ่ม Shopee Clip";
        open.Enabled = !busy && (!online || !stopping);
        stop.Enabled = !busy && online && !stopping;
        Invalidate();
    }

    async Task RefreshStudio()
    {
        if (busy) return;
        busy = true;
        bool wasOnline = online;
        bool wasStopping = stopping;
        online = await ReadStatus();
        if (IsDisposed) return;
        if (online) status.Text = stopping ? "กำลังปิดระบบ\nรอให้คลิปที่กำลังทำเสร็จ" : "ระบบพร้อมใช้งาน";
        else if (wasOnline || status.Text == "กำลังตรวจสถานะ") status.Text = wasStopping ? "ปิดระบบแล้ว" : "ระบบยังไม่เปิด";
        busy = false;
        UpdateControls();
    }

    async Task OpenStudio()
    {
        if (busy) return;
        busy = true;
        UpdateControls();
        try
        {
            if (!online)
            {
                string exe = Path.Combine(root, "app", "target", "release", "shopee-clip.exe");
                status.Text = "กำลังเปิดระบบ";
                using (var child = Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true }))
                {
                    for (int i = 0; i < 20 && !child.HasExited; i++)
                    {
                        if (await ReadStatus()) { online = true; break; }
                        await Task.Delay(250);
                    }
                }
                if (!online) throw new InvalidOperationException("เปิดระบบไม่ได้ ตรวจว่าเซิร์ฟเวอร์พร้อมใช้งาน");
            }
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            status.Text = "ระบบพร้อมใช้งาน";
        }
        catch (Exception error) { if (!IsDisposed) status.Text = error.Message; }
        finally { busy = false; if (!IsDisposed) UpdateControls(); }
    }

    async Task StopStudio()
    {
        if (busy) return;
        busy = true;
        UpdateControls();
        try
        {
            using (var response = await client.PostAsync(url + "/api/shutdown", null)) response.EnsureSuccessStatusCode();
            stopping = true;
            status.Text = "กำลังปิดระบบ\nรอให้คลิปที่กำลังทำเสร็จ";
        }
        catch (Exception error) { if (!IsDisposed) status.Text = error.Message; }
        finally { busy = false; if (!IsDisposed) UpdateControls(); }
    }
}
