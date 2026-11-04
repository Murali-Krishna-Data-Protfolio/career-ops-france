' 08:30 PC sync (Task Scheduler) with no console window: pull cloud results,
' Windows popup for new matches, push local changes. Log: data\daily-scan.log
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """C:\Program Files\nodejs\node.exe"" sync-alerts.mjs --log", 0, True
