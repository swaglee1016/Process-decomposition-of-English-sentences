using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.7.2",FrameworkDisplayName=".NET Framework 4.7.2")]

namespace SentenceInstaller {
    public class Component {
        public string Id,Name,Version,Url,Sha256,Kind,Executable,LicenseUrl;
        public long Size;
    }
    public class ToolPaths { public string Node,Java,PlantUml; }
    public class SetupProgress { public string Message; public int Percent; }
    public class InstallerCore {
        static InstallerCore() {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
        }
        const string Marker="sentence-process-installer-v1";
        readonly string root;
        readonly Component[] components;
        readonly Action<SetupProgress> report;
        readonly JavaScriptSerializer json=new JavaScriptSerializer();
        public string Root { get { return root; } }
        public InstallerCore(string root,Component[] components,Action<SetupProgress> progress) {
            ValidateRoot(root);this.root=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);this.components=components;report=progress??(p=>{});
            foreach(var c in components) {
                if(c.Id!="node"&&c.Id!="java"&&c.Id!="plantuml")throw new InvalidDataException("未知运行组件。");
                ValidateDownloadUri(new Uri(c.Url));
                if(c.Sha256==null||c.Sha256.Length!=64||c.Sha256.Any(ch=>!Uri.IsHexDigit(ch)))throw new InvalidDataException("组件校验清单无效。");
                Inside(root,c.Executable);
            }
        }
        void Progress(string message,int percent) { report(new SetupProgress{Message=message,Percent=Math.Max(0,Math.Min(100,percent))}); }
        public static bool IsValidKey(string key) { return !String.IsNullOrWhiteSpace(key)&&key.Length>=8&&key.Length<=512&&key.All(c=>c>=33&&c<=126); }
        public static void ValidateRoot(string path) {
            if(String.IsNullOrWhiteSpace(path)||!Path.IsPathRooted(path)||path.StartsWith(@"\\",StringComparison.Ordinal))throw new IOException("请选择本机的完整安装路径。");
            string full=Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            if(full==Path.GetPathRoot(full).TrimEnd(Path.DirectorySeparatorChar)||full.Length>160)throw new IOException("请选择磁盘中的独立文件夹（路径不超过 160 字符）。");
            CheckNoLinks(full);
        }
        static void CheckNoLinks(string full) {
            string p=full;
            while(!String.IsNullOrEmpty(p)) {
                try {if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new IOException("安装路径不能经过符号链接或目录联接。");}
                catch(FileNotFoundException){}catch(DirectoryNotFoundException){}
                p=Path.GetDirectoryName(p);
            }
        }
        static string Inside(string directory,string relative) {
            if(String.IsNullOrEmpty(relative)||relative.IndexOf(':')>=0||Path.IsPathRooted(relative))throw new InvalidDataException("压缩包路径无效。");
            foreach(string segment in relative.Replace('\\','/').TrimEnd('/').Split('/')) {
                string stem=segment.Split('.')[0].ToUpperInvariant();
                if(String.IsNullOrEmpty(segment)||segment=="."||segment==".."||segment.EndsWith(".")||segment.EndsWith(" ")||segment.IndexOfAny(Path.GetInvalidFileNameChars())>=0||new[]{"CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"}.Contains(stem))throw new InvalidDataException("压缩包包含不安全的文件名。");
            }
            string full=Path.GetFullPath(Path.Combine(directory,relative.Replace('/',Path.DirectorySeparatorChar)));
            string prefix=Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("压缩包试图写入安装目录以外的位置。");
            CheckNoLinks(full);return full;
        }
        string InstalledPath(params string[] parts) {return Inside(root,Path.Combine(parts));}
        void OwnDirectory() {
            ValidateRoot(root);foreach(string name in new[]{".sentence-installer","cache","runtime","settings","app","Reader.exe"})InstalledPath(name);
            string marker=InstalledPath(".sentence-installer");
            if(Directory.Exists(root)&&Directory.EnumerateFileSystemEntries(root).Any()&&(!File.Exists(marker)||File.ReadAllText(marker)!=Marker))throw new IOException("所选文件夹已有其他内容。请选择一个空文件夹，避免覆盖现有文件。");
            Directory.CreateDirectory(root);if(!File.Exists(marker))File.WriteAllText(marker,Marker,new UTF8Encoding(false));
            Directory.CreateDirectory(InstalledPath("cache"));Directory.CreateDirectory(InstalledPath("runtime"));Directory.CreateDirectory(InstalledPath("settings"));
        }
        static string FindExecutable(string name) {
            foreach(string dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(Path.PathSeparator)) {
                try {
                    string candidate=dir.Trim().Trim('"');
                    if(String.IsNullOrWhiteSpace(candidate)||!Path.IsPathRooted(candidate)||candidate.Length<3||candidate[1]!=':'||(candidate[2]!='\\'&&candidate[2]!='/'))continue;
                    string f=Path.Combine(candidate,name);if(File.Exists(f))return Path.GetFullPath(f);
                }catch(ArgumentException){}
            }return null;
        }
        static string Run(string exe,string args,string cwd,int timeout,string input) {
            var info=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true};
            if(!String.IsNullOrEmpty(cwd))info.WorkingDirectory=cwd;
            using(var p=Process.Start(info)) {
                var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();
                if(input!=null)p.StandardInput.Write(input);p.StandardInput.Close();
                if(!p.WaitForExit(timeout)){try{p.Kill();}catch{}throw new IOException("组件检查超时，请重试。");}
                Task.WaitAll(new Task[]{stdout,stderr},3000);
                if(p.ExitCode!=0)throw new IOException("组件无法正常运行。");
                return stdout.Result+stderr.Result;
            }
        }
        public static string Quote(string value) {
            if(value.IndexOf('"')>=0||value.IndexOf('\r')>=0||value.IndexOf('\n')>=0)throw new ArgumentException("Invalid command argument");
            return "\""+value.TrimEnd('\\')+"\"";
        }
        static bool GoodNode(string node) {
            if(String.IsNullOrEmpty(node)||!File.Exists(node))return false;
            try {string script="const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<13))process.exit(2);require('node:sqlite');console.log('NODE_OK');";return Run(node,"-e "+Quote(script),null,12000,null).Contains("NODE_OK");}catch{return false;}
        }
        static bool GoodJava(string java) {
            if(String.IsNullOrEmpty(java)||!File.Exists(java))return false;
            try {string output=Run(java,"-version",null,12000,null);var m=System.Text.RegularExpressions.Regex.Match(output,"version \\\"([0-9]+)");return m.Success&&Int32.Parse(m.Groups[1].Value)>=17;}catch{return false;}
        }
        static bool GoodDiagram(string java,string jar) {
            if(String.IsNullOrEmpty(java)||String.IsNullOrEmpty(jar)||!File.Exists(jar))return false;
            try {string svg=Run(java,"-Djava.awt.headless=true -DPLANTUML_SECURITY_PROFILE=SANDBOX -Xmx256m -jar "+Quote(jar)+" -tsvg -pipe",null,30000,"@startmindmap\n* Ready\n** Local diagram\n@endmindmap\n");return svg.Contains("<svg")&&svg.Contains("</svg>");}catch{return false;}
        }
        string LocalTool(string id) {var c=components.FirstOrDefault(x=>x.Id==id);return c==null?null:Inside(InstalledPath("runtime",id),c.Executable);}
        public ToolPaths Detect(bool ignoreExisting=false) {
            Progress("正在检查运行环境…",0);var paths=new ToolPaths();
            string node=LocalTool("node"),java=LocalTool("java"),jar=LocalTool("plantuml");
            if(GoodNode(node))paths.Node=node;
            if(GoodJava(java))paths.Java=java;
            if(!ignoreExisting) {
                if(paths.Node==null) { node=FindExecutable("node.exe");if(GoodNode(node))paths.Node=node; }
                if(paths.Java==null) {
                    string home=Environment.GetEnvironmentVariable("JAVA_HOME");java=String.IsNullOrEmpty(home)?null:Path.Combine(home,"bin","java.exe");
                    if(!GoodJava(java))java=FindExecutable("java.exe");if(GoodJava(java))paths.Java=java;
                }
            }
            if(GoodDiagram(paths.Java,jar))paths.PlantUml=jar;
            if(paths.PlantUml==null&&!ignoreExisting&&paths.Java!=null) {
                jar=Environment.GetEnvironmentVariable("PLANTUML_JAR");if(GoodDiagram(paths.Java,jar))paths.PlantUml=jar;
                string home=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                foreach(string editor in new[]{".vscode",".vscode-insiders"}) {
                    string dir=Path.Combine(home,editor,"extensions");if(!Directory.Exists(dir))continue;
                    foreach(string ext in Directory.GetDirectories(dir,"jebbs.plantuml-*").OrderByDescending(x=>x)) {
                        if(paths.PlantUml!=null)break;jar=Path.Combine(ext,"plantuml.jar");if(GoodDiagram(paths.Java,jar))paths.PlantUml=jar;
                    }
                }
            }
            Progress("检查完成。已有的可用组件会直接复用。",0);return paths;
        }
        public static void ValidateDownloadUri(Uri uri) {
            string[] hosts={"nodejs.org","github.com","api.adoptium.net","release-assets.githubusercontent.com","objects.githubusercontent.com"};
            if(uri.Scheme!=Uri.UriSchemeHttps||uri.Port!=443||!String.IsNullOrEmpty(uri.UserInfo)||!hosts.Contains(uri.DnsSafeHost.ToLowerInvariant()))throw new InvalidDataException("下载地址不在允许的官方 HTTPS 来源中。");
        }
        public static bool HashMatches(string file,string expected) {
            CheckNoLinks(Path.GetFullPath(file));
            if(!File.Exists(file)||String.IsNullOrEmpty(expected)||expected.Length!=64)return false;
            using(var sha=SHA256.Create())using(var stream=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").Equals(expected,StringComparison.OrdinalIgnoreCase);
        }
        string Download(Component c,CancellationToken ct,int index) {
            string destination=InstalledPath("cache",c.Id+"-"+c.Sha256+ (c.Kind=="zip"?".zip":".jar"));
            if(HashMatches(destination,c.Sha256)){Progress("复用已校验的 "+c.Name+" 下载",index*25);return destination;}
            string partial=destination+"."+Guid.NewGuid().ToString("N")+".part";
            ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
            Uri uri=new Uri(c.Url);HttpWebResponse response=null;
            for(int attempt=0;attempt<8;attempt++) {
                ct.ThrowIfCancellationRequested();ValidateDownloadUri(uri);
                var req=(HttpWebRequest)WebRequest.Create(uri);req.AllowAutoRedirect=false;req.Timeout=30000;req.ReadWriteTimeout=30000;req.UserAgent="SentenceProcessSetup/1.0";
                using(ct.Register(()=>req.Abort())) {
                    try {response=(HttpWebResponse)req.GetResponse();} catch(WebException){ct.ThrowIfCancellationRequested();throw new IOException("无法下载 "+c.Name+"。请检查网络后重试。");}
                }
                int status=(int)response.StatusCode;
                if(status>=300&&status<400) {string location=response.Headers["Location"];response.Dispose();response=null;if(String.IsNullOrEmpty(location))throw new IOException("下载跳转无效。");uri=new Uri(uri,location);continue;}
                break;
            }
            if(response==null)throw new IOException("下载跳转次数过多。");
            CheckNoLinks(partial);
            using(response)using(ct.Register(()=>{try{response.Close();}catch{}}))using(var input=response.GetResponseStream())using(var output=new FileStream(partial,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                if(response.StatusCode!=HttpStatusCode.OK)throw new IOException("下载服务暂不可用。");
                long total=response.ContentLength>0?response.ContentLength:c.Size,read=0;byte[] buffer=new byte[65536];int length;var watch=Stopwatch.StartNew();long last=0;
                while((length=ReadDownload(input,buffer,ct))>0) {
                    ct.ThrowIfCancellationRequested();read+=length;
                    if(read>1024L*1024*1024||(c.Size>0&&read>c.Size))throw new IOException("下载大小超出清单，已停止。");
                    output.Write(buffer,0,length);
                    if(watch.ElapsedMilliseconds-last>200){last=watch.ElapsedMilliseconds;Progress("正在下载 "+c.Name+"："+(read/1048576.0).ToString("F1")+" / "+(total/1048576.0).ToString("F1")+" MB",index*25+(int)(Math.Min(1,total>0?(double)read/total:0)*20));}
                }
            }
            ct.ThrowIfCancellationRequested();Progress("正在校验 "+c.Name+"…",index*25+21);
            if(!HashMatches(partial,c.Sha256))throw new IOException(c.Name+" 下载校验失败，未执行该文件。请重试。");
            if(File.Exists(destination))destination=destination+"."+Guid.NewGuid().ToString("N");
            CheckNoLinks(partial);CheckNoLinks(destination);File.Move(partial,destination);return destination;
        }
        static int ReadDownload(Stream input,byte[] buffer,CancellationToken ct) {try{return input.Read(buffer,0,buffer.Length);}catch{ct.ThrowIfCancellationRequested();throw;}}
        public static void SafeExtract(string archive,string destination,CancellationToken ct) {
            CheckNoLinks(Path.GetFullPath(archive));CheckNoLinks(Path.GetFullPath(destination));
            using(var zip=ZipFile.OpenRead(archive)) {
                long total=0;var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach(var entry in zip.Entries) {
                    ct.ThrowIfCancellationRequested();string target=Inside(destination,entry.FullName);
                    if(!names.Add(target)||((entry.ExternalAttributes>>16)&0xF000)==0xA000)throw new InvalidDataException("压缩包含重复或链接路径。");
                    total+=entry.Length;if(total>2L*1024*1024*1024||zip.Entries.Count>50000)throw new InvalidDataException("压缩包超出允许大小。");
                }
                Directory.CreateDirectory(destination);
                foreach(var entry in zip.Entries) {
                    ct.ThrowIfCancellationRequested();string target=Inside(destination,entry.FullName);
                    if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if(File.Exists(target)) {
                        using(var src=entry.Open())using(var existing=File.OpenRead(target))using(var sha=SHA256.Create()) {
                            var a=sha.ComputeHash(src);var b=sha.ComputeHash(existing);if(!a.SequenceEqual(b))throw new IOException("安装目录存在不同版本的文件。请换一个空目录安装，原文件已保留。");
                        }continue;
                    }
                    string pending=Path.Combine(Path.GetDirectoryName(target),"sp-"+Guid.NewGuid().ToString("N").Substring(0,16)+".part");
                    using(var src=entry.Open())using(var dst=new FileStream(pending,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                        byte[] buffer=new byte[65536];int read;
                        while((read=src.Read(buffer,0,buffer.Length))>0){ct.ThrowIfCancellationRequested();dst.Write(buffer,0,read);}
                    }
                    ct.ThrowIfCancellationRequested();File.Move(pending,target);
                }
            }
        }
        public Task<ToolPaths> PrepareAsync(ToolPaths detected,CancellationToken ct) {
            return Task.Run(()=> {
                OwnDirectory();var result=new ToolPaths{Node=detected.Node,Java=detected.Java,PlantUml=detected.PlantUml};int i=0;
                foreach(var c in components) {
                    string existing=c.Id=="node"?result.Node:c.Id=="java"?result.Java:result.PlantUml;
                    if(existing!=null){i++;continue;}
                    string archive=Download(c,ct,i++),dest=InstalledPath("runtime",c.Id);Progress("正在准备 "+c.Name+"…",i*25-3);
                    if(c.Kind=="zip")SafeExtract(archive,dest,ct);
                    else {Directory.CreateDirectory(dest);string target=Inside(dest,c.Executable);if(!File.Exists(target))File.Copy(archive,target);else if(!HashMatches(target,c.Sha256))throw new IOException("已有组件内容不同，请换一个安装目录。");}
                    string executable=Inside(dest,c.Executable);if(c.Id=="node")result.Node=executable;else if(c.Id=="java")result.Java=executable;else result.PlantUml=executable;
                }
                ct.ThrowIfCancellationRequested();Progress("正在验证运行和绘图能力…",85);
                if(!GoodNode(result.Node)||!GoodJava(result.Java)||!GoodDiagram(result.Java,result.PlantUml))throw new IOException("运行组件未通过检查。请检查下载或换一个安装目录重试。");
                Progress("环境已准备好，请填写 DeepSeek API Key。",100);return result;
            },ct);
        }
        static string ResourceToFile(string resource,string destination) {
            CheckNoLinks(Path.GetFullPath(destination));
            using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)) {
                if(input==null)throw new IOException("安装包缺少内置程序，请重新下载安装包。");
                if(File.Exists(destination)) {
                    using(var existing=File.OpenRead(destination))using(var sha=SHA256.Create())if(sha.ComputeHash(input).SequenceEqual(sha.ComputeHash(existing)))return destination;
                    throw new IOException("安装包与现有版本不同，请选择新的安装目录。");
                }
                using(var output=new FileStream(destination,FileMode.CreateNew))input.CopyTo(output);return destination;
            }
        }
        ProcessStartInfo NodeStart(ToolPaths paths,string key,string args) {
            var info=new ProcessStartInfo(paths.Node,args){WorkingDirectory=InstalledPath("app"),UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
            info.EnvironmentVariables["DEEPSEEK_API_KEY"]=key;info.EnvironmentVariables["DEEPSEEK_MODEL"]="deepseek-chat";info.EnvironmentVariables["PLANTUML_JAR"]=paths.PlantUml;
            info.EnvironmentVariables["JAVA_HOME"]=Path.GetDirectoryName(Path.GetDirectoryName(paths.Java));
            info.EnvironmentVariables["PATH"]=Path.GetDirectoryName(paths.Node)+Path.PathSeparator+Path.GetDirectoryName(paths.Java)+Path.PathSeparator+(info.EnvironmentVariables["PATH"]??"");
            return info;
        }
        void ProbeApplication(ToolPaths paths,string key,CancellationToken ct) {
            string script="const app=require('./server').createApp();const s=app.listen(0,'127.0.0.1',async()=>{try{const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/health');if(!r.ok)throw Error('health');console.log('INSTALL_OK')}catch(e){process.exitCode=2}finally{s.closeAllConnections();s.close(()=>{app.locals.closeVocabulary();process.exit(process.exitCode||0)})}});";
            using(var p=Process.Start(NodeStart(paths,key,"-e "+Quote(script)))) {
                var output=p.StandardOutput.ReadToEndAsync();var error=p.StandardError.ReadToEndAsync();
                using(ct.Register(()=>{try{p.Kill();}catch{}})) {
                    if(!p.WaitForExit(30000)){try{p.Kill();}catch{}throw new IOException("应用启动检查超时。");}
                    ct.ThrowIfCancellationRequested();Task.WaitAll(new Task[]{output,error},3000);
                    if(p.ExitCode!=0||!output.Result.Contains("INSTALL_OK"))throw new IOException("应用启动检查未通过，请检查安装路径和运行环境。");
                }
            }
        }
        public static bool ShouldRestartReader(string oldKey,string newKey,string expectedProject,string actualProject,int activeJobs) {
            if(oldKey==newKey||expectedProject!=actualProject)return false;
            if(activeJobs>0)throw new IOException("当前正在分析。请先完成或暂停分析，再保存新的 API Key。");
            return true;
        }
        public static bool IsReaderUnavailable(WebException error) {
            if(error.Status!=WebExceptionStatus.ConnectFailure)return false;
            for(Exception cause=error.InnerException;cause!=null;cause=cause.InnerException) {
                var socket=cause as System.Net.Sockets.SocketException;
                if(socket!=null&&socket.SocketErrorCode==System.Net.Sockets.SocketError.ConnectionRefused)return true;
            }
            return false;
        }
        Dictionary<string,object> ReaderRequest(string endpoint,bool post) {
            var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3456/api/reader/"+endpoint);
            req.Proxy=null;req.AllowAutoRedirect=false;req.Timeout=2500;req.ReadWriteTimeout=2500;req.KeepAlive=false;req.Headers["X-Reader-Client"]="workspace";
            if(post){req.Method="POST";req.ContentType="application/json";req.ContentLength=2;using(var output=req.GetRequestStream()){byte[] body=Encoding.UTF8.GetBytes("{}");output.Write(body,0,body.Length);}}
            using(var response=(HttpWebResponse)req.GetResponse())using(var input=new StreamReader(response.GetResponseStream()))return json.Deserialize<Dictionary<string,object>>(input.ReadToEnd());
        }
        void StopOwnReaderForKeyChange(string newKey,CancellationToken ct) {
            string keyFile=InstalledPath("settings","key.bin");if(!File.Exists(keyFile))return;
            byte[] previous=ProtectedData.Unprotect(File.ReadAllBytes(keyFile),null,DataProtectionScope.CurrentUser);string oldKey;
            try{oldKey=Encoding.UTF8.GetString(previous);}finally{Array.Clear(previous,0,previous.Length);}
            if(oldKey==newKey)return;
            Dictionary<string,object> state;
            try{state=ReaderRequest("status",false);}catch(WebException e){if(IsReaderUnavailable(e))return;throw new IOException("无法确认阅读器状态，请稍后重试。原 API Key 未更改。");}catch(InvalidOperationException){throw new IOException("无法确认阅读器状态，请稍后重试。原 API Key 未更改。");}
            object actual,active,instance;
            if(!state.TryGetValue("projectId",out actual)||!state.TryGetValue("activeJobs",out active)||!state.TryGetValue("instanceId",out instance))return;
            string expected;using(var sha=SHA256.Create())expected=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(InstalledPath("app").ToLowerInvariant()))).Replace("-","").ToLowerInvariant();
            if(!ShouldRestartReader(oldKey,newKey,expected,Convert.ToString(actual),Convert.ToInt32(active)))return;
            ct.ThrowIfCancellationRequested();Progress("正在停止空闲后台，以便使用新的 API Key…",72);
            try{ReaderRequest("restart",true);}catch(WebException){throw new IOException("后台暂时不能重启，请完成或暂停分析后再保存。原 API Key 未更改。");}
            var wait=Stopwatch.StartNew();
            while(wait.ElapsedMilliseconds<6000) {
                ct.ThrowIfCancellationRequested();Thread.Sleep(100);
                try {var now=ReaderRequest("status",false);object current;if(!now.TryGetValue("instanceId",out current)||Convert.ToString(current)!=Convert.ToString(instance))throw new IOException("后台状态已变化，请重试保存。原 API Key 未更改。");}
                catch(WebException e){if(IsReaderUnavailable(e))return;throw new IOException("无法确认后台已停止，请稍后重试。原 API Key 未更改。");}
            }
            throw new IOException("后台未能停止，请稍后重试。原 API Key 未更改。");
        }
        public Task CompleteAsync(ToolPaths paths,string key,bool desktopShortcut,CancellationToken ct) {
            if(!IsValidKey(key))throw new ArgumentException("请输入有效的 API Key（不能包含空格或换行）。");
            return Task.Run(()=> {
                OwnDirectory();ct.ThrowIfCancellationRequested();Progress("正在安装阅读程序…",10);
                string payload=ResourceToFile("app.zip",InstalledPath("cache","app.zip"));SafeExtract(payload,InstalledPath("app"),ct);
                Progress("正在检查阅读服务…",50);ProbeApplication(paths,key,ct);ct.ThrowIfCancellationRequested();
                string self=Assembly.GetExecutingAssembly().Location,target=InstalledPath("Reader.exe");
                if(!String.Equals(Path.GetFullPath(self),target,StringComparison.OrdinalIgnoreCase)) {
                    if(File.Exists(target)) {using(var sha=SHA256.Create())using(var a=File.OpenRead(self))using(var b=File.OpenRead(target))if(!sha.ComputeHash(a).SequenceEqual(sha.ComputeHash(b)))throw new IOException("已有启动器版本不同，请换一个安装目录。");}
                    else File.Copy(self,target);
                }
                StopOwnReaderForKeyChange(key,ct);ct.ThrowIfCancellationRequested();Progress("正在保存本机设置…",80);
                byte[] plain=Encoding.UTF8.GetBytes(key);try {File.WriteAllBytes(InstalledPath("settings","key.bin"),ProtectedData.Protect(plain,null,DataProtectionScope.CurrentUser));}finally{Array.Clear(plain,0,plain.Length);}
                File.WriteAllText(InstalledPath("settings","tools.json"),json.Serialize(paths),new UTF8Encoding(false));
                if(desktopShortcut)CreateShortcut(target);
                File.WriteAllText(InstalledPath("settings","installed"),Marker,new UTF8Encoding(false));Progress("程序已安装完成。",100);
            },ct);
        }
        static object GetProperty(object obj,string name) {return obj.GetType().InvokeMember(name,BindingFlags.GetProperty,null,obj,null);}
        static void SetProperty(object obj,string name,object value) {obj.GetType().InvokeMember(name,BindingFlags.SetProperty,null,obj,new[]{value});}
        void CreateShortcut(string target) {
            string desktop=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);if(String.IsNullOrEmpty(desktop))throw new IOException("找不到桌面目录，请取消创建桌面入口后重试。");
            string file=Path.Combine(desktop,"英文精读.lnk");object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));object shortcut=null;
            try {
                shortcut=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});
                if(File.Exists(file)&&(!String.Equals(Convert.ToString(GetProperty(shortcut,"TargetPath")),target,StringComparison.OrdinalIgnoreCase)||Convert.ToString(GetProperty(shortcut,"Arguments"))!="--launch"))throw new IOException("桌面已有同名的其他快捷方式。请取消创建桌面入口后重试。");
                SetProperty(shortcut,"TargetPath",target);SetProperty(shortcut,"Arguments","--launch");SetProperty(shortcut,"WorkingDirectory",root);SetProperty(shortcut,"Description","英文精读：原文、译文与语法结构图");SetProperty(shortcut,"WindowStyle",7);
                shortcut.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,shortcut,null);
            } finally {if(shortcut!=null)System.Runtime.InteropServices.Marshal.ReleaseComObject(shortcut);System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);}
        }
        public void Launch() {
            if(!File.Exists(InstalledPath("settings","installed")))throw new IOException("尚未完成安装，请先运行安装向导。");
            var paths=json.Deserialize<ToolPaths>(File.ReadAllText(InstalledPath("settings","tools.json")));
            byte[] plain=ProtectedData.Unprotect(File.ReadAllBytes(InstalledPath("settings","key.bin")),null,DataProtectionScope.CurrentUser);string key;try{key=Encoding.UTF8.GetString(plain);}finally{Array.Clear(plain,0,plain.Length);}
            if(!IsValidKey(key)||!GoodNode(paths.Node)||!GoodJava(paths.Java)||!File.Exists(paths.PlantUml))throw new IOException("运行环境或密钥配置不可用，请重新打开安装向导。");
            string signalName="launch-"+Guid.NewGuid().ToString("N")+".json";
            string signal=InstalledPath("settings",signalName);
            string script="const fs=require('fs');const signal='../settings/"+signalName+"';const report=(value)=>{if(fs.lstatSync('..').isSymbolicLink()||fs.lstatSync('../settings').isSymbolicLink())throw Error('unsafe settings');fs.writeFileSync(signal,value,{flag:'wx'})};require('./launcher').startApplication({log:()=>{},notify:m=>{require('./services/readerWindow').showLaunchMessage(m).catch(()=>{})}}).then(()=>report('true')).catch(()=>{report('false');process.exitCode=1});";
            var info=NodeStart(paths,key,"-e "+Quote(script));info.RedirectStandardOutput=false;info.RedirectStandardError=false;
            using(var process=Process.Start(info)) {
                bool successful=false;var wait=Stopwatch.StartNew();
                while(wait.ElapsedMilliseconds<20000) {
                    CheckNoLinks(signal);if(File.Exists(signal)){try{successful=File.ReadAllText(signal)=="true";break;}catch(IOException){}}
                    if(process.HasExited)break;Thread.Sleep(100);
                }
                if(!successful){if(!process.HasExited){try{process.Kill();}catch{}}throw new IOException("无法启动阅读器。固定地址可能被另一份程序占用，请关闭旧阅读器后重试。");}
                // No inherited output pipes: the background server survives the launcher window closing.
            }
        }
    }
}
