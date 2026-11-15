using System;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Diagnostics;
using System.Reflection;
using SentenceInstaller;

class CoreTests {
    static int count;
    static void Check(bool ok, string title) { if (!ok) throw new Exception(title); count++; Console.WriteLine("PASS " + title); }
    static void Reject(Action action, string title) { bool failed=false;try { action(); } catch { failed=true; } Check(failed,title); }
    static void Junction(string link,string target) {
        var start=new ProcessStartInfo("cmd.exe","/d /c mklink /J "+InstallerCore.Quote(link)+" "+InstallerCore.Quote(target)){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        using(var process=Process.Start(start)){string output=process.StandardOutput.ReadToEnd()+process.StandardError.ReadToEnd();process.WaitForExit();if(process.ExitCode!=0)throw new Exception("Could not create junction regression fixture: "+output);}
    }
    static int Main(string[] args) {
        try {
            string folder=Path.GetFullPath(args.Length>0?args[0]:"outputs/core-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
            Check(InstallerCore.IsValidKey("test-placeholder-not-a-real-key"),"printable key accepted");
            Check(!InstallerCore.IsValidKey("abc\r\nInjected=1"),"multiline key rejected");
            Check(!InstallerCore.IsValidKey("   "),"empty key rejected");
            Reject(()=>InstallerCore.ValidateRoot(""),"empty installation path rejected");
            Check(!InstallerCore.ShouldRestartReader("old","new","this-app","other-app",0),"key change never restarts another installation");
            Check(!InstallerCore.ShouldRestartReader("same","same","this-app","this-app",0),"same key preserves running reader");
            Check(InstallerCore.ShouldRestartReader("old","new","this-app","this-app",0),"changed key restarts own idle reader");
            Reject(()=>InstallerCore.ShouldRestartReader("old","new","this-app","this-app",1),"changed key refuses busy reader before saving");
            Check(InstallerCore.IsReaderUnavailable(new System.Net.WebException("refused",new System.Net.Sockets.SocketException((int)System.Net.Sockets.SocketError.ConnectionRefused),System.Net.WebExceptionStatus.ConnectFailure,null)),"connection refused means no running reader");
            Check(!InstallerCore.IsReaderUnavailable(new System.Net.WebException("timeout",System.Net.WebExceptionStatus.Timeout)),"status timeout does not mean reader stopped");
            Check(!InstallerCore.IsReaderUnavailable(new System.Net.WebException("forbidden",System.Net.WebExceptionStatus.ProtocolError)),"HTTP refusal does not mean reader stopped");
            Check(!InstallerCore.IsReaderUnavailable(new System.Net.WebException("connect unknown",System.Net.WebExceptionStatus.ConnectFailure)),"unknown connection error preserves old key");
            Reject(()=>InstallerCore.ValidateRoot(Path.GetPathRoot(folder)),"drive root rejected");
            Reject(()=>InstallerCore.ValidateDownloadUri(new Uri("http://nodejs.org/a.zip")),"HTTP rejected");
            Reject(()=>InstallerCore.ValidateDownloadUri(new Uri("https://github.com.evil.test/a.zip")),"lookalike host rejected");
            Reject(()=>InstallerCore.ValidateDownloadUri(new Uri("https://user:secret@github.com/a.zip")),"userinfo rejected");
            InstallerCore.ValidateDownloadUri(new Uri("https://nodejs.org/dist/test.zip"));Check(true,"official HTTPS allowed");
            string plain=Path.Combine(folder,"plain.txt");File.WriteAllText(plain,"hello",new UTF8Encoding(false));
            Check(InstallerCore.HashMatches(plain,"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),"matching SHA256 accepted");
            Check(!InstallerCore.HashMatches(plain,new string('0',64)),"corrupt hash rejected");
            string bad=Path.Combine(folder,"traversal.zip");using(var z=ZipFile.Open(bad,ZipArchiveMode.Create)){using(var w=new StreamWriter(z.CreateEntry("../escape.txt").Open()))w.Write("bad");}
            Reject(()=>InstallerCore.SafeExtract(bad,Path.Combine(folder,"dest"),System.Threading.CancellationToken.None),"archive traversal rejected");
            Check(!File.Exists(Path.Combine(folder,"escape.txt")),"traversal created no outside file");
            string good=Path.Combine(folder,"safe.zip");using(var z=ZipFile.Open(good,ZipArchiveMode.Create)){using(var w=new StreamWriter(z.CreateEntry("nested/file.txt").Open()))w.Write("ok");}
            InstallerCore.SafeExtract(good,Path.Combine(folder,"good"),System.Threading.CancellationToken.None);Check(File.ReadAllText(Path.Combine(folder,"good/nested/file.txt"))=="ok","safe zip extracted");
            File.WriteAllText(Path.Combine(folder,"good/nested/file.txt"),"existing-other-version");
            Reject(()=>InstallerCore.SafeExtract(good,Path.Combine(folder,"good"),System.Threading.CancellationToken.None),"different existing version is not overwritten");
            Check(File.ReadAllText(Path.Combine(folder,"good/nested/file.txt"))=="existing-other-version","existing file preserved after conflict");
            var canceled=new System.Threading.CancellationToken(true);
            Reject(()=>InstallerCore.SafeExtract(good,Path.Combine(folder,"canceled"),canceled),"pre-canceled extraction refuses work");
            Check(!Directory.Exists(Path.Combine(folder,"canceled")),"pre-cancel creates no output");
            string stranger=Path.Combine(folder,"unrelated");Directory.CreateDirectory(stranger);File.WriteAllText(Path.Combine(stranger,"mine.txt"),"keep");
            Reject(()=>new InstallerCore(stranger,new Component[0],p=>{}).PrepareAsync(new ToolPaths(),System.Threading.CancellationToken.None).GetAwaiter().GetResult(),"unrelated directory rejected");
            byte[] cipher=ProtectedData.Protect(Encoding.UTF8.GetBytes("test-only"),null,DataProtectionScope.CurrentUser);Check(Encoding.UTF8.GetString(ProtectedData.Unprotect(cipher,null,DataProtectionScope.CurrentUser))=="test-only","current-user encryption roundtrip");
            string cwd=Environment.CurrentDirectory,pathValue=Environment.GetEnvironmentVariable("PATH"),shadow=Path.Combine(folder,"shadow");Directory.CreateDirectory(shadow);File.WriteAllText(Path.Combine(shadow,"node.exe"),"never execute");
            try {
                Environment.CurrentDirectory=shadow;
                foreach(string unsafePath in new[]{"",";",".","relative", "C:relative", "\\relative"}) {
                    Environment.SetEnvironmentVariable("PATH",unsafePath);
                    string found=(string)typeof(InstallerCore).GetMethod("FindExecutable",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{"node.exe"});
                    Check(found==null,"PATH skips empty and non-absolute directory: "+unsafePath);
                }
                Environment.SetEnvironmentVariable("PATH",shadow);
                string absolute=(string)typeof(InstallerCore).GetMethod("FindExecutable",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{"node.exe"});
                Check(absolute==Path.Combine(shadow,"node.exe"),"PATH accepts explicitly absolute directory");
            }finally{Environment.CurrentDirectory=cwd;Environment.SetEnvironmentVariable("PATH",pathValue);}
            string longZip=Path.Combine(folder,"long-path.zip"),longRelative=new string('a',80)+"/"+new string('b',80)+"/"+new string('c',80)+"/long.txt";
            using(var z=ZipFile.Open(longZip,ZipArchiveMode.Create)){using(var w=new StreamWriter(z.CreateEntry(longRelative).Open()))w.Write("long path safe");}
            InstallerCore.SafeExtract(longZip,Path.Combine(folder,"long-path 中文"),System.Threading.CancellationToken.None);
            Check(File.ReadAllText(Path.Combine(folder,"long-path 中文",longRelative.Replace('/',Path.DirectorySeparatorChar)))=="long path safe","long Unicode archive path remains supported");
            foreach(string reserved in new[]{"cache","settings","runtime","app","Reader.exe",".sentence-installer"}) {
                string owned=Path.Combine(folder,"junction-"+reserved.Replace('.','_')),outside=Path.Combine(folder,"outside-"+reserved.Replace('.','_'));Directory.CreateDirectory(owned);Directory.CreateDirectory(outside);
                if(reserved!=".sentence-installer")File.WriteAllText(Path.Combine(owned,".sentence-installer"),"sentence-process-installer-v1");
                Junction(Path.Combine(owned,reserved),outside);
                var core=new InstallerCore(owned,new Component[0],p=>{});
                Reject(()=>typeof(InstallerCore).GetMethod("OwnDirectory",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(core,null),"owned root refuses junction: "+reserved);
                Check(!Directory.EnumerateFileSystemEntries(outside).GetEnumerator().MoveNext(),"junction target unchanged: "+reserved);
            }
            Console.WriteLine("PASS TOTAL "+count);return 0;
        } catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);return 1;}
    }
}
