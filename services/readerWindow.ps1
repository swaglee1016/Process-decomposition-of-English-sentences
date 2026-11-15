param(
    [ValidateSet('Activate','Notice')][string]$Mode = 'Activate',
    [string]$Message = '',
    [string]$ReaderTitle = 'English Sentences Process Decomposition - Local Reader'
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ReaderWindowNative {
    private delegate bool EnumCallback(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int MessageBox(IntPtr owner, string text, string caption, uint type);
    public static IntPtr[] VisibleWindows() {
        var result = new List<IntPtr>();
        EnumWindows((handle, parameter) => { if (IsWindowVisible(handle)) result.Add(handle); return true; }, IntPtr.Zero);
        return result.ToArray();
    }
    public static bool Activate(IntPtr handle) {
        if (IsIconic(handle)) ShowWindowAsync(handle, 9);
        SetForegroundWindow(handle);
        return GetForegroundWindow() == handle;
    }
    public static void Notice(string message) { MessageBox(IntPtr.Zero, message, "English Reader", 0x00050040); }
}
'@
if ($Mode -eq 'Notice') {
    [ReaderWindowNative]::Notice($Message)
    exit 0
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$deadline = [DateTime]::UtcNow.AddSeconds(6)
do {
    foreach ($handle in [ReaderWindowNative]::VisibleWindows()) {
        try {
            [uint32]$browserProcessId = 0
            [void][ReaderWindowNative]::GetWindowThreadProcessId($handle, [ref]$browserProcessId)
            $browserProcess = Get-Process -Id $browserProcessId -ErrorAction Stop
            if ($browserProcess.ProcessName -notin @('chrome','msedge','firefox')) { continue }
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
            $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            foreach ($tab in $tabs) {
                # Chromium can append a localized memory-usage status to the accessible tab name.
                if ($tab.Current.Name -ne $ReaderTitle -and -not $tab.Current.Name.StartsWith($ReaderTitle + ' - ')) { continue }
                $selection = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $selection.Select()
                if ([ReaderWindowNative]::Activate($handle)) { Write-Output 'FOCUSED'; exit 0 }
            }
        } catch { continue }
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
Write-Output 'NOT_FOUND'
