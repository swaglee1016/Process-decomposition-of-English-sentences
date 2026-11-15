using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.Web.Script.Serialization;
using System.Net;
using System.Reflection;
using SentenceInstaller;

class VerifyInstall {
    static string ReaderStatus() {
        var request=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3456/api/reader/status");request.Proxy=null;request.Timeout=2500;request.Headers["X-Reader-Client"]="workspace";
        using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
            var values=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(reader.ReadToEnd());return Convert.ToString(values["instanceId"]);
        }
    }
    [STAThread] static int Main(string[] args) {
        try {
            if(args.Length<2)throw new Exception("mode and installation root required");
            string mode=args[0], root=Path.GetFullPath(args[1]);
            var components=SetupForm.ReadComponents();
            var engine=new InstallerCore(root,components,p=>Console.WriteLine(p.Percent+"% "+p.Message));
            if(mode=="prepare"||mode=="resume") {
                var paths=engine.Detect(true);
                if(mode=="prepare"&&(paths.Node!=null||paths.Java!=null||paths.PlantUml!=null))throw new Exception("fresh missing-component fixture expected");
                paths=engine.PrepareAsync(paths,CancellationToken.None).GetAwaiter().GetResult();
                Console.WriteLine("PASS real official downloads, hashes, runtime and drawing probes");
            } else if(mode=="complete") {
                var paths=engine.Detect(true);
                if(paths.Node==null||paths.Java==null||paths.PlantUml==null)throw new Exception("prepared components missing");
                var fakeKey="verification-only-"+Guid.NewGuid().ToString("N");
                engine.CompleteAsync(paths,fakeKey,false,CancellationToken.None).GetAwaiter().GetResult();
                var encrypted=File.ReadAllBytes(Path.Combine(root,"settings","key.bin"));
                if(System.Text.Encoding.UTF8.GetString(encrypted).Contains(fakeKey))throw new Exception("plaintext key persisted");
                engine.CompleteAsync(paths,fakeKey,false,CancellationToken.None).GetAwaiter().GetResult();
                Console.WriteLine("PASS install, repeat install, encrypted synthetic key, application health probe; no desktop mutation");
            } else if(mode=="launch-conflict") {
                var before=ReaderStatus();bool refused=false;
                try {engine.Launch();}catch(IOException){refused=true;}
                if(!refused||ReaderStatus()!=before)throw new Exception("foreign reader must remain unchanged on port conflict");
                Console.WriteLine("PASS occupied-port launch rejected; existing reader instance preserved");
            } else if(mode=="extract-node") {
                var component=Array.Find(components,c=>c.Id=="node");
                var cache=Path.Combine(root,"cache","node-"+component.Sha256+".zip");
                if(!InstallerCore.HashMatches(cache,component.Sha256))throw new Exception("node cache not verified");
                InstallerCore.SafeExtract(cache,Path.Combine(root,"runtime","node"),CancellationToken.None);
                Console.WriteLine("PASS full Node archive extraction including deep paths and resume");
            } else if(mode=="ui") {
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                using(var form=new SetupForm(root)) {
                    form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-20000,-20000);
                    form.Show();Application.DoEvents();
                    if(form.Controls.Find("NextButton",true).Length!=1)throw new Exception("next button unavailable");
                    using(var bitmap=new Bitmap(form.Width,form.Height)) {form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));bitmap.Save(args[2]);}
                    var flags=BindingFlags.NonPublic|BindingFlags.Instance;
                    typeof(SetupForm).GetField("paths",flags).SetValue(form,engine.Detect(true));
                    foreach(var page in new[]{"Confirm","KeyPage","Done"}) {
                        typeof(SetupForm).GetMethod(page,flags).Invoke(form,null);Application.DoEvents();
                        if(page=="KeyPage") {var input=(TextBox)form.Controls.Find("ApiKey",true)[0];if(!input.UseSystemPasswordChar)throw new Exception("key input is not masked");}
                        using(var bitmap=new Bitmap(form.Width,form.Height)) {form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));bitmap.Save(Path.Combine(Path.GetDirectoryName(args[2]),"installer-"+page+".png"));}
                    }
                    form.Close();
                }
                Console.WriteLine("PASS native setup form created and rendered");
            } else throw new Exception("Unknown mode");
            return 0;
        }catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}
    }
}
