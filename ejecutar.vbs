REM ========================================
REM SCRIPT EJECUTOR VBS - RECIBOS APP
REM Inicia servidor + navegador sin mostrar consola
REM ========================================

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strCurrentPath = objShell.CurrentDirectory
objShell.CurrentDirectory = strCurrentPath

REM Verificar que las dependencias existen
if not fso.FolderExists(strCurrentPath & "\node_modules") then
    MsgBox "ERROR: Las dependencias no estan instaladas." & vbCrLf & vbCrLf & "Primero ejecute: install.bat", vbCritical, "RECIBOS APP - Error"
    WScript.Quit 1
end if

REM Verificar que server.js existe
if not fso.FileExists(strCurrentPath & "\server.js") then
    MsgBox "ERROR: Falta server.js", vbCritical, "RECIBOS APP - Error"
    WScript.Quit 1
end if

REM Verificar que mejor-sqlite3 funciona
on error resume next
CreateObject("WScript.Shell").Exec("cmd /c node -e ""const db = require('better-sqlite3')(':memory:'); console.log('OK');""").StdOut.ReadAll()
if Err.Number <> 0 then
    MsgBox "Detectado problema con modulos nativos." & vbCrLf & vbCrLf & "Se intenta reconstruir...", vbInformation, "RECIBOS APP"
    objShell.Run "cmd /c npm rebuild better-sqlite3", 0, True
end if
on error goto 0

REM Iniciar servidor en background (sin mostrar ventana)
objShell.Run "cmd /c node server.js", 0, False

REM Esperar a que el servidor esté listo (4 segundos)
WScript.Sleep 4000

REM Abrir navegador
objShell.Run "http://localhost:3000"

REM Mostrar notificación
MsgBox "Servidor iniciado en http://localhost:3000" & vbCrLf & vbCrLf & "El navegador se abrira automaticamente." & vbCrLf & vbCrLf & "Para generar PDFs, instala Google Chrome desde:" & vbCrLf & "https://www.google.com/chrome/", vbInformation, "RECIBOS APP"
