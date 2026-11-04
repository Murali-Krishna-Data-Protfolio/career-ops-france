' Starts the Job Inbox server with no console window (used at logon and by job-inbox.cmd).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """C:\Program Files\nodejs\node.exe"" job-inbox.mjs", 0, False
