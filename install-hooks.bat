@echo off
setlocal

set "HOOKS_SRC=%~dp0.githooks"
set "HOOKS_DST=%~dp0.git\hooks"

echo Instalando hooks desde %HOOKS_SRC% a %HOOKS_DST%...

for %%f in ("%HOOKS_SRC%\*") do (
  copy "%%f" "%HOOKS_DST%\%%~nxf" >nul
  echo   ✔ %%~nxf
)

echo ✅ Hooks instalados correctamente
