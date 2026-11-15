using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace SentenceInstaller {
    public sealed class SetupForm : Form {
        readonly Component[] components;
        readonly Label heading = new Label(), subtitle = new Label(), status = new Label();
        readonly FlowLayoutPanel content = new FlowLayoutPanel();
        readonly Button next = new Button(), back = new Button(), cancel = new Button();
        readonly ProgressBar progress = new ProgressBar();
        TextBox directory, key;
        CheckBox shortcut;
        InstallerCore engine;
        ToolPaths paths;
        CancellationTokenSource cancellation;
        string installRoot;
        int page;
        bool busy;

        public SetupForm() : this(null) {}
        public SetupForm(string initialRoot) {
            components = ReadComponents();
            installRoot = initialRoot ?? DefaultRoot();
            Text = "英文精读 · 安装与设置";
            Name = "SetupWindow";
            Font = new Font("Microsoft YaHei UI", 10F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(800, 630);
            MinimumSize = new Size(760, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            var header = new Panel { Dock = DockStyle.Top, Height = 112, Padding = new Padding(28,20,28,8), BackColor = Color.FromArgb(241,246,250) };
            heading.Dock = DockStyle.Top; heading.Height = 42; heading.Font = new Font(Font.FontFamily, 19, FontStyle.Bold);
            subtitle.Dock = DockStyle.Bottom; subtitle.Height = 28; subtitle.ForeColor = Color.FromArgb(67,82,98);
            header.Controls.Add(heading); header.Controls.Add(subtitle);
            var footer = new Panel { Dock = DockStyle.Bottom, Height = 115, Padding = new Padding(28,8,28,12) };
            status.Dock = DockStyle.Top; status.Height = 25; status.AutoEllipsis = true;
            progress.Dock = DockStyle.Top; progress.Height = 8;
            var actions = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            next.Name = "NextButton"; next.Width = 210; next.Height = 38; next.BackColor = Color.FromArgb(31,92,135); next.ForeColor = Color.White; next.FlatStyle = FlatStyle.Flat;
            cancel.Text = "退出"; cancel.Width = 95; cancel.Height = 38;
            back.Text = "上一步"; back.Width = 95; back.Height = 38;
            actions.Controls.Add(next); actions.Controls.Add(cancel); actions.Controls.Add(back);
            footer.Controls.Add(progress); footer.Controls.Add(status); footer.Controls.Add(actions);
            content.Dock = DockStyle.Fill; content.Padding = new Padding(28,16,20,8); content.AutoScroll = true;
            content.FlowDirection = FlowDirection.TopDown; content.WrapContents = false;
            Controls.Add(content); Controls.Add(footer); Controls.Add(header);
            next.Click += async (s,e) => await Advance();
            back.Click += (s,e) => Welcome();
            cancel.Click += (s,e) => { if (busy) { cancellation.Cancel(); status.Text = "正在取消，请稍候…"; } else Close(); };
            FormClosing += (s,e) => { if (busy) { e.Cancel = true; cancellation.Cancel(); status.Text = "正在安全停止，完成后可退出。"; } };
            Welcome();
        }
        public static Component[] ReadComponents() {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("manifest.json"))
            using (var reader = new StreamReader(stream)) return new JavaScriptSerializer().Deserialize<Component[]>(reader.ReadToEnd());
        }
        static string DefaultRoot() {
            var here = AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(here,"settings","tools.json"))) return here.TrimEnd(Path.DirectorySeparatorChar);
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SentenceProcess");
        }
        void Clear(string title, string detail, string button) {
            content.Controls.Clear(); heading.Text = title; subtitle.Text = detail; next.Text = button;
            status.Text = ""; progress.Value = 0; back.Visible = page > 0 && page < 4;
        }
        void TextLine(string text, bool bold = false) {
            content.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(700,0), Margin = new Padding(0,0,0,14), Font = bold ? new Font(Font,FontStyle.Bold) : Font });
        }
        void Link(string text, string url) {
            var link = new LinkLabel { Text = text, AutoSize = true, Margin = new Padding(0,0,0,10) };
            link.LinkClicked += (s,e) => { try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); } catch { MessageBox.Show(this,"无法打开浏览器，请手动访问：\n"+url,"打开链接"); } };
            content.Controls.Add(link);
        }
        void Welcome() {
            page = 0; Clear("让英文精读更简单", "检查准备情况  →  自动安装  →  填写密钥  →  开始阅读", "检查准备情况");
            TextLine("原文、中文译文、语法结构图并排阅读。\n本向导会帮你准备所需组件，不需要输入命令。",true);
            TextLine("已有且可用的组件直接使用。需要下载时，会先列出内容并征求你的同意。\n仅为本应用准备环境，不修改系统环境变量。首次准备需要联网。");
            TextLine("安装位置");
            var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0,0,0,14) };
            directory = new TextBox { Name = "InstallDirectory", Text = installRoot, Width = 560 };
            var browse = new Button { Text = "选择…", Width = 90, Height = 30 };
            browse.Click += (s,e) => { using(var dialog = new FolderBrowserDialog { Description = "选择专用于英文精读的空目录，或已有安装目录", SelectedPath = installRoot }) { if(dialog.ShowDialog(this)==DialogResult.OK) directory.Text=dialog.SelectedPath; } };
            row.Controls.Add(directory); row.Controls.Add(browse); content.Controls.Add(row);
            TextLine("支持 Windows 10 / 11（x64）。安装包包含阅读程序；Node.js、Java 与 PlantUML 缺少时才下载。\n已有安装可重新检查并修改密钥。原有书籍与笔记不会自动清理。");
        }
        void Confirm() {
            page = 1; Clear("确认准备内容", "检查已完成。点击同意后才开始下载和安装。", "同意下载并安装");
            long bytes = 0;
            foreach(var c in components) {
                var found = c.Id=="node" ? paths.Node : c.Id=="java" ? paths.Java : paths.PlantUml;
                if (String.IsNullOrEmpty(found)) { bytes += c.Size; TextLine(c.Name+"  ·  需要下载 "+c.Version+"  ·  "+(c.Size/1048576.0).ToString("F1")+" MB",true); }
                else TextLine(c.Name+"  ·  已找到可用组件，无需下载",true);
                Link("下载来源与许可："+new Uri(c.Url).Host+" / "+c.Name,c.LicenseUrl);
            }
            TextLine("预计下载："+(bytes/1048576.0).ToString("F1")+" MB。下载后会核对文件完整性，再安装到：\n"+installRoot);
            TextLine("Node.js 用于运行阅读程序，Java 与 PlantUML 用于在本机生成语法图。\n如果此前准备被中断，可复用已下载且校验通过的文件。");
            if(bytes == 0) next.Text="同意准备应用";
        }
        void KeyPage() {
            page = 2; Clear("填写 DeepSeek API Key", "组件已准备好。完成设置后即可打开阅读工具。", "保存并完成安装"); back.Visible=false;
            TextLine("API Key 是你自己的 DeepSeek 服务密钥。请输入后保存；再次运行安装向导可以修改。",true);
            Link("打开 DeepSeek 控制台，获取 API Key", "https://platform.deepseek.com/api_keys");
            key = new TextBox { Name = "ApiKey", Width = 660, UseSystemPasswordChar = true, MaxLength = 256, Margin = new Padding(0,4,0,8) };
            content.Controls.Add(key);
            var show = new CheckBox { Text="显示密钥", AutoSize=true, Margin=new Padding(0,0,0,14) };
            show.CheckedChanged += (s,e)=>key.UseSystemPasswordChar=!show.Checked; content.Controls.Add(show);
            TextLine("密钥仅在当前 Windows 用户下加密保存，不写入安装包或日志。\n安装时只检查输入格式，不调用 AI、不验证余额。实际分析、翻译与查词会连接 DeepSeek，并可能产生费用。");
            shortcut = new CheckBox { Text="创建桌面“英文精读”快捷方式", Checked=true, AutoSize=true }; content.Controls.Add(shortcut);
            TextLine("已有同名但不属于本应用的快捷方式会被保留。安装后的数据保存在应用目录中；备份方法见安装说明。");
        }
        void Done() {
            page = 3; Clear("程序已安装完成", "下次双击桌面入口或安装目录中的 Reader.exe 即可。", "立即打开");back.Visible=false;
            TextLine("运行组件、应用启动和本机绘图检查已完成。",true);
            TextLine("点击“立即打开”后，阅读器会在默认浏览器中打开。\n关闭本窗口不会影响阅读。\n\n你的 API Key 已保存，但尚未向 DeepSeek 发起验证请求；如遇密钥错误，再运行安装向导修改即可。");
            TextLine("安装位置：\n"+installRoot);
            Link("查看详细安装与使用说明",new Uri(Path.Combine(installRoot,"app","docs","INSTALL.md")).AbsoluteUri);
            cancel.Text="完成";
        }
        void SetBusy(bool value) {
            busy=value;next.Enabled=!value;back.Enabled=!value;cancel.Text=value?"取消":"退出";
        }
        void Report(SetupProgress p) {
            if(IsDisposed) return;
            if(InvokeRequired) { BeginInvoke(new Action<SetupProgress>(Report),p);return; }
            status.Text=p.Message;progress.Value=Math.Max(0,Math.Min(100,p.Percent));
        }
        async Task Advance() {
            if(busy) return;
            cancellation=new CancellationTokenSource();SetBusy(true);
            try {
                if(page==0) {
                    if(!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major<10) throw new InvalidOperationException("当前版本支持 Windows 10 / 11 x64。");
                    installRoot=Path.GetFullPath(directory.Text.Trim());InstallerCore.ValidateRoot(installRoot);
                    engine=new InstallerCore(installRoot,components,Report);status.Text="正在检查本机组件，请稍候…";
                    paths=await Task.Run(()=>engine.Detect());cancellation.Token.ThrowIfCancellationRequested();Confirm();
                } else if(page==1) {
                    paths=await engine.PrepareAsync(paths,cancellation.Token);KeyPage();
                } else if(page==2) {
                    var value=key.Text.Trim();if(!InstallerCore.IsValidKey(value)) throw new InvalidOperationException("请输入有效格式的 API Key；不要包含空格、换行或控制字符。");
                    await engine.CompleteAsync(paths,value,shortcut.Checked,cancellation.Token);key.Text="";Done();
                } else { await Task.Run(()=>engine.Launch());CloseAfterWork(); }
            } catch(OperationCanceledException) {
                status.Text="已取消。已完成的下载会保留，稍后可以重试。";
            } catch(Exception error) {
                status.Text="未完成，请修正后重试。";
                MessageBox.Show(this,error.Message,"需要处理一下",MessageBoxButtons.OK,MessageBoxIcon.Information);
            } finally { SetBusy(false);cancellation.Dispose();if(page==3)cancel.Text="完成"; }
        }
        void CloseAfterWork() { busy=false;Close(); }
    }
    static class Program {
        [STAThread] static void Main(string[] args) {
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            try {
                var root=AppDomain.CurrentDomain.BaseDirectory;
                bool launch=args.Contains("--launch") || (Path.GetFileName(Application.ExecutablePath).Equals("Reader.exe",StringComparison.OrdinalIgnoreCase) && !args.Contains("--settings"));
                if(launch) new InstallerCore(root,SetupForm.ReadComponents(),p=>{}).Launch();
                else Application.Run(new SetupForm());
            } catch(Exception error) { MessageBox.Show(error.Message+"\n\n如需修改密钥，请重新运行安装程序。","英文精读",MessageBoxButtons.OK,MessageBoxIcon.Warning); }
        }
    }
}
