param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ProcessId)

# Read only the process owning the fixed debug listener. No WMI, browser launch,
# privilege adjustment, process-memory reads, profile access or site requests.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class DedicatedChromeProcess {
    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool QueryFullProcessImageName(IntPtr handle, int flags, StringBuilder text, ref int size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr handle, int kind, IntPtr data, int size, out int returned);
    public sealed class Evidence {
        public int pid;
        public string name;
        public string commandLine;
        public string createdAt;
    }
    public static Evidence Read(int pid) {
        // PROCESS_QUERY_LIMITED_INFORMATION only. Never request debug privileges.
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) throw new InvalidOperationException("owner_unreadable");
        try {
            int capacity = 32768;
            var image = new StringBuilder(capacity);
            long created, exited, kernel, user;
            if (!QueryFullProcessImageName(handle, 0, image, ref capacity)
                || !GetProcessTimes(handle, out created, out exited, out kernel, out user)
                || exited != 0) throw new InvalidOperationException("owner_unreadable");
            if (!String.Equals(Path.GetFileName(image.ToString()), "chrome.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("owner_not_chrome");
            // ProcessCommandLineInformation (Windows 8.1+). An unsupported API or
            // unreadable process fails closed; there is no unchecked fallback.
            int needed;
            NtQueryInformationProcess(handle, 60, IntPtr.Zero, 0, out needed);
            if (needed < Marshal.SizeOf(typeof(UnicodeString)) || needed > 65536)
                throw new InvalidOperationException("owner_unreadable");
            IntPtr buffer = Marshal.AllocHGlobal(needed);
            try {
                int returned;
                if (NtQueryInformationProcess(handle, 60, buffer, needed, out returned) != 0)
                    throw new InvalidOperationException("owner_unreadable");
                var text = (UnicodeString)Marshal.PtrToStructure(buffer, typeof(UnicodeString));
                long offset = text.Buffer.ToInt64() - buffer.ToInt64();
                if (text.Length == 0 || text.Length > 32768 || text.Length % 2 != 0
                    || text.MaximumLength < text.Length || offset < Marshal.SizeOf(typeof(UnicodeString))
                    || offset > needed - text.Length)
                    throw new InvalidOperationException("owner_unreadable");
                return new Evidence { pid=pid, name="chrome.exe",
                    commandLine=Marshal.PtrToStringUni(text.Buffer, text.Length/2),
                    createdAt=DateTime.FromFileTimeUtc(created).ToString("o") };
            } finally { Marshal.FreeHGlobal(buffer); }
        } finally { CloseHandle(handle); }
    }
}
'@
    [DedicatedChromeProcess]::Read($ProcessId) | ConvertTo-Json -Compress
} catch {
    # Never put command lines, profiles or native exception text in error logs.
    [Console]::Error.WriteLine('dedicated_chrome_owner_query_failed')
    exit 1
}
