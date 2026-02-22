@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

REM ============================================================
REM  使用 WSL2 构建沙箱虚拟机镜像
REM  前置条件：已安装 WSL2 + Ubuntu（请先运行 setup-wsl.ps1）
REM ============================================================

set ROOT_DIR=%~dp0..
set ARCH=%~1
if "%ARCH%"=="" set ARCH=amd64

echo ============================================================
echo   通过 WSL 构建沙箱虚拟机镜像（架构：%ARCH%）
echo ============================================================
echo.

REM 检查 WSL 是否可用
wsl --version >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 错误：WSL 未安装。
    echo 请先以管理员身份运行：powershell -ExecutionPolicy Bypass -File scripts\setup-wsl.ps1
    exit /b 1
)

REM 检查 Ubuntu 是否可用
wsl -d Ubuntu-22.04 -- echo "ok" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    REM 尝试默认的 Ubuntu
    wsl -d Ubuntu -- echo "ok" >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo 错误：WSL 中未找到 Ubuntu。
        echo 请运行：wsl --install -d Ubuntu-22.04
        exit /b 1
    )
    set WSL_DISTRO=Ubuntu
) else (
    set WSL_DISTRO=Ubuntu-22.04
)

echo 使用的 WSL 发行版：%WSL_DISTRO%
echo.

REM 将 Windows 路径转换为 WSL 路径
for /f "usebackq tokens=*" %%i in (`wsl -d %WSL_DISTRO% -- wslpath -a "%ROOT_DIR%"`) do set WSL_ROOT=%%i

echo 项目根目录（WSL）：%WSL_ROOT%
echo.

REM 步骤 1：在 WSL 中安装构建依赖
echo [1/4] 正在 WSL 中安装构建依赖...
wsl -d %WSL_DISTRO% -- bash -c "sudo apt-get update -qq && sudo apt-get install -y -qq qemu-utils parted e2fsprogs dosfstools kpartx rsync tar curl util-linux udev xz-utils 2>&1 | tail -3"
if %ERRORLEVEL% neq 0 (
    echo 错误：安装依赖失败。
    exit /b 1
)
echo       完成。
echo.

REM 步骤 2：运行构建脚本
echo [2/4] 正在构建沙箱镜像（架构：%ARCH%）...
echo        这将下载 Alpine Linux 并创建虚拟机镜像。
echo        请稍候...
echo.

wsl -d %WSL_DISTRO% -- bash -c "cd '%WSL_ROOT%' && ARCHS=%ARCH% AGENT_RUNNER_BUILD=auto sudo -E sandbox/image/build.sh"
if %ERRORLEVEL% neq 0 (
    echo.
    echo 错误：构建失败。
    exit /b 1
)

REM 步骤 3：修复文件权限（WSL root 用户创建的文件）
echo.
echo [3/4] 正在修复文件权限...
wsl -d %WSL_DISTRO% -- bash -c "sudo chmod -R a+rw '%WSL_ROOT%/sandbox/image/out/' 2>/dev/null; true"

REM 步骤 4：验证输出
echo [4/4] 正在验证输出...
echo.

set OUTPUT_FILE=%ROOT_DIR%\sandbox\image\out\linux-%ARCH%.qcow2
if exist "%OUTPUT_FILE%" (
    echo   成功！
    echo   输出文件：sandbox\image\out\linux-%ARCH%.qcow2
    for %%A in ("%OUTPUT_FILE%") do echo   文件大小：%%~zA 字节
    echo.
    echo 下一步：python scripts\upload-sandbox-image.py --arch %ARCH%
) else (
    echo   警告：未找到预期的输出文件：%OUTPUT_FILE%
    echo   请检查上方的构建输出以查找错误。
    dir "%ROOT_DIR%\sandbox\image\out\" 2>nul
)

echo.
endlocal
