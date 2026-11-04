' 08:00 daily run (Task Scheduler) with no console window. Log: data\daily-scan.log
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """C:\Program Files\nodejs\node.exe"" daily-run.mjs --log", 0, True
