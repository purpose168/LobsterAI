@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

REM ============================================================
REM  完整流水线：构建 + 上传 + 显示更新说明
REM  用法：scripts\rebuild-sandbox.bat [amd64|arm64]
REM ============================================================

set ROOT_DIR=%~dp0..
set ARCH=%~1
if "%ARCH%"=="" set ARCH=amd64

echo.
echo ================================================================
echo   沙箱虚拟机镜像重建流水线
echo   架构：%ARCH%
echo ================================================================
echo.

REM 步骤 1：构建
echo === 步骤 1：构建镜像 ===
echo.
call "%ROOT_DIR%\scripts\build-sandbox-in-wsl.bat" %ARCH%
if %ERRORLEVEL% neq 0 (
    echo.
    echo 构建失败。已中止。
    exit /b 1
)

REM 步骤 2：检查 Python
echo.
echo === 步骤 2：上传到 CDN ===
echo.

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 错误：未找到 Python。请先安装 Python。
    echo 您可以稍后手动上传：python scripts\upload-sandbox-image.py --arch %ARCH%
    exit /b 1
)

REM 检查 requests 模块
python -c "import requests" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 正在安装 requests 模块...
    pip install requests -q
)

python "%ROOT_DIR%\scripts\upload-sandbox-image.py" --arch %ARCH%

echo.
echo ================================================================
echo   流水线完成！
echo
echo   别忘了更新以下文件中的 CDN URL：
echo     electron\libs\coworkSandboxRuntime.ts
echo
echo   找到 DEFAULT_SANDBOX_IMAGE_URL_%ARCH% 并将 URL 替换为
echo   上面打印的地址。
echo ================================================================
echo.

endlocal
