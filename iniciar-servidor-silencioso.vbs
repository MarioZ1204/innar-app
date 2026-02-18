REM ========================================
REM SCRIPT VBS - INICIO SILENCIOSO DEL SERVIDOR
REM Este script inicia el servidor sin mostrar ventana
REM ========================================

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

REM Obtener la ruta del script actual
strScriptPath = objShell.CurrentDirectory
If strScriptPath = "" Then
    strScriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
End If

REM Cambiar al directorio del proyecto
objShell.CurrentDirectory = strScriptPath

REM Verificar que las dependencias existen
If Not fso.FolderExists(strScriptPath & "\node_modules") Then
    REM Si no existen dependencias, intentar instalarlas silenciosamente
    objShell.Run "cmd /c cd /d """ & strScriptPath & """ && install.bat", 0, True
End If

REM Verificar que server.js existe
If Not fso.FileExists(strScriptPath & "\server.js") Then
    WScript.Quit 1
End If

REM Iniciar servidor en background (sin mostrar ventana)
REM Usar /min para minimizar la ventana si es necesario
objShell.Run "cmd /c cd /d """ & strScriptPath & """ && node server.js", 0, False

REM El script termina pero el servidor sigue corriendo en background
