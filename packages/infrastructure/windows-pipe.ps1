param([ValidateSet('Host','AnonymousProbe','Inspect')][string]$Mode = 'Host', [Parameter(Mandatory=$true)][string]$PipeName, [string]$Directory)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
Add-Type -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class DogPipe {
  static readonly object OutputLock = new object();
  static readonly ConcurrentDictionary<string, TaskCompletionSource<byte[]>> Replies = new ConcurrentDictionary<string, TaskCompletionSource<byte[]>>();
  static readonly ConcurrentDictionary<string, NamedPipeServerStream> Connections = new ConcurrentDictionary<string, NamedPipeServerStream>();
  static readonly SemaphoreSlim Slots = new SemaphoreSlim(16);
  static volatile bool Stopped;
  static NamedPipeServerStream Listener;
  static string Owner;
  static string Pipe;
  static bool First = true;
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maximumInstances, uint outputSize, uint inputSize, uint timeout, ref SecurityAttributes attributes);
  static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 5 * 1024 * 1024 }; }
  static void Output(object value) { lock(OutputLock) { Console.Out.WriteLine(Json().Serialize(value)); Console.Out.Flush(); } }
  static PipeSecurity Security() {
    var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
    var sid = new SecurityIdentifier(Owner);
    security.SetOwner(sid);
    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
    return security;
  }
  static NamedPipeServerStream Create() {
    if (!First) return new NamedPipeServerStream(Pipe, PipeDirection.InOut, 17, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, Security());
    byte[] descriptor = Security().GetSecurityDescriptorBinaryForm(); IntPtr pointer = Marshal.AllocHGlobal(descriptor.Length);
    try {
      Marshal.Copy(descriptor, 0, pointer, descriptor.Length);
      var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = pointer, Inherit = false };
      var handle = CreateNamedPipe(@"\\.\pipe\" + Pipe, 0x40080003, 8, 17, 4096, 4096, 0, ref attributes);
      if (handle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      First = false;
      return new NamedPipeServerStream(PipeDirection.InOut, true, false, new SafePipeHandle(handle, true));
    } finally { Marshal.FreeHGlobal(pointer); }
  }
  static void ProtectDirectory(string directory) {
    string full = Path.GetFullPath(directory);
    string allowed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "codex-dog", "profiles") + Path.DirectorySeparatorChar;
    if (!full.StartsWith(allowed, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Directory outside application profiles");
    var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
    var sid = new SecurityIdentifier(Owner); security.SetOwner(sid);
    security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    System.IO.Directory.CreateDirectory(full, security);
    System.IO.Directory.SetAccessControl(full, security);
  }
  static byte[] ReadExact(Stream stream, int size) {
    var data = new byte[size]; int read = 0;
    while (read < size) { int next = stream.Read(data, read, size - read); if (next == 0) throw new EndOfStreamException(); read += next; }
    return data;
  }
  static void Respond(Stream stream, byte[] body) { var header = BitConverter.GetBytes(body.Length); stream.Write(header, 0, header.Length); stream.Write(body, 0, body.Length); stream.Flush(); }
  static byte[] Error(string code) { return Encoding.UTF8.GetBytes(Json().Serialize(new { ok = false, error = new { code = code, message = "Local pipe request rejected" }, meta = new { apiVersion = "2", requestId = "unassigned" } })); }
  static void Serve(NamedPipeServerStream pipe) {
    string id = Guid.NewGuid().ToString("N"); Connections[id] = pipe;
    using (var timer = new Timer(_ => { try { pipe.Dispose(); } catch {} }, null, 15000, Timeout.Infinite)) {
      try {
        int size = BitConverter.ToInt32(ReadExact(pipe, 4), 0);
        if (size < 1 || size > 1024 * 1024) { Respond(pipe, Error("INPUT_TOO_LARGE")); return; }
        var body = Encoding.UTF8.GetString(ReadExact(pipe, size));
        string peer = null;
        pipe.RunAsClient(() => { peer = WindowsIdentity.GetCurrent().User.Value; });
        if (peer != Owner) { Respond(pipe, Error("PERMISSION_DENIED")); return; }
        var completion = new TaskCompletionSource<byte[]>(); Replies[id] = completion;
        timer.Change(45000, Timeout.Infinite);
        Output(new { type = "request", id = id, peerSid = peer, body = body });
        if (completion.Task.Wait(40000)) Respond(pipe, completion.Task.Result);
        else Respond(pipe, Error("READ_TIMEOUT"));
      } catch { /* The connection may have timed out or closed; never log the payload. */ }
      finally { TaskCompletionSource<byte[]> ignored; Replies.TryRemove(id, out ignored); NamedPipeServerStream old; Connections.TryRemove(id, out old); pipe.Dispose(); Slots.Release(); }
    }
  }
  static void Accept() {
    while (!Stopped) {
      try {
        Slots.Wait(); if (Stopped) { Slots.Release(); break; }
        var current = Listener; current.WaitForConnection();
        Listener = Create();
        Task.Run(() => Serve(current));
      } catch { if (!Stopped) { Output(new { type = "fatal", message = "Pipe accept failed" }); Stop(); } }
    }
  }
  static void Stop() {
    Stopped = true; try { if (Listener != null) Listener.Dispose(); } catch {}
    foreach (var item in Connections) { try { item.Value.Dispose(); } catch {} }
    foreach (var item in Replies) item.Value.TrySetResult(Error("APP_STOPPING"));
    try { Slots.Release(); } catch {}
  }
  public static void Host(string name, string directory) {
    if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^codex-dog-g02-[a-f0-9]{16}-[a-zA-Z0-9_-]{1,40}$")) throw new InvalidOperationException("Invalid pipe name");
    Owner = WindowsIdentity.GetCurrent().User.Value; Pipe = name; ProtectDirectory(directory); Listener = Create();
    Output(new { type = "ready", pid = System.Diagnostics.Process.GetCurrentProcess().Id, ownerSid = Owner,
      pipeSddl = Listener.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Access), rootProtected = System.IO.Directory.GetAccessControl(directory).AreAccessRulesProtected });
    var accepting = Task.Run((Action)Accept);
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        if (line.Length > 5 * 1024 * 1024) break;
        var value = Json().Deserialize<Dictionary<string, object>>(line);
        if ((string)value["type"] == "stop") break;
        TaskCompletionSource<byte[]> completion;
        if ((string)value["type"] == "response" && Replies.TryGetValue((string)value["id"], out completion)) completion.TrySetResult(Encoding.UTF8.GetBytes((string)value["body"]));
      }
    } finally { Stop(); accepting.Wait(2000); }
  }
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool ImpersonateAnonymousToken(IntPtr thread);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool RevertToSelf();
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentThread();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Probe(string name) {
    int error = 0; bool connected = false;
    if (!ImpersonateAnonymousToken(GetCurrentThread())) throw new InvalidOperationException("Anonymous impersonation unavailable");
    try { var handle = CreateFile(@"\\.\pipe\" + name, 0xC0000000, 0, IntPtr.Zero, 3, 0, IntPtr.Zero); connected = handle != new IntPtr(-1); error = Marshal.GetLastWin32Error(); if (connected) CloseHandle(handle); }
    finally { RevertToSelf(); }
    Output(new { denied = !connected && error == 5, error = error });
  }
  public static void Inspect(string name, string directory) {
    using (var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.None, TokenImpersonationLevel.Identification)) {
      client.Connect(3000);
      Output(new { ownerSid = WindowsIdentity.GetCurrent().User.Value, pipeSddl = client.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Access), rootProtected = System.IO.Directory.GetAccessControl(directory).AreAccessRulesProtected,
        rootSddl = System.IO.Directory.GetAccessControl(directory).GetSecurityDescriptorSddlForm(AccessControlSections.Access) });
    }
  }
}
'@
if ($Mode -eq 'AnonymousProbe') { [DogPipe]::Probe($PipeName) }
elseif ($Mode -eq 'Inspect') { [DogPipe]::Inspect($PipeName, $Directory) }
else { [DogPipe]::Host($PipeName, $Directory) }
} catch {
  $failure = $_.Exception
  while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
  $code = 'PIPE_HOST_INIT_FAILED'
  $detail = [int]$failure.HResult
  if ($failure -is [System.ComponentModel.Win32Exception]) { $code = 'PIPE_WIN32_ERROR'; $detail = $failure.NativeErrorCode }
  elseif ($failure -is [System.UnauthorizedAccessException]) { $code = 'PIPE_ACCESS_DENIED' }
  elseif ($failure -is [System.Security.SecurityException]) { $code = 'PIPE_SECURITY_ERROR' }
  elseif ($failure -is [System.IO.IOException]) { $code = 'PIPE_IO_ERROR' }
  [Console]::Out.WriteLine((@{type='fatal';code=$code;detail=$detail} | ConvertTo-Json -Compress))
  exit 1
}
