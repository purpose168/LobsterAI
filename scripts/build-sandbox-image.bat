@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  使用 Docker Desktop 在 Windows 上构建沙箱虚拟机镜像
REM  用法：scripts\build-sandbox-image.bat [amd64|arm64|all]
REM ============================================================

set ROOT_DIR=%~dp0..
set IMAGE_NAME=lobsterai-sandbox-image-builder
set DOCKERFILE=%ROOT_DIR%\sandbox\image\Dockerfile
set BUILD_CONTEXT=%ROOT_DIR%\sandbox\image
set ARCHS=%~1

if "%ARCHS%"=="" set ARCHS=amd64

REM 检查 Docker 是否可用
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 错误：未找到 Docker。请先安装 Docker Desktop。
    echo 下载地址：https://www.docker.com/products/docker-desktop/
    exit /b 1
)

REM 检查 Docker 是否正在运行
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 错误：Docker 未运行。请启动 Docker Desktop。
    exit /b 1
)

echo ============================================================
echo  正在构建沙箱虚拟机镜像（架构：%ARCHS%）
echo ============================================================
echo.

REM 构建用于构建环境的 Docker 镜像
echo [1/3] 正在构建 Docker 构建器镜像...
docker build -f "%DOCKERFILE%" -t "%IMAGE_NAME%" "%BUILD_CONTEXT%"
if %ERRORLEVEL% neq 0 (
    echo 错误：构建 Docker 镜像失败。
    exit /b 1
)

REM 将 Windows 路径转换为 Docker 兼容路径
REM Windows 上的 Docker Desktop 可以使用 /host_mnt/c/... 或直接使用 Windows 路径
set DOCKER_ROOT=%ROOT_DIR:\=/%

echo [2/3] 正在 Docker 容器内运行镜像构建...
echo        架构：%ARCHS%
echo        这可能需要几分钟时间...
echo.

docker run --rm --privileged ^
    -e ARCHS=%ARCHS% ^
    -e AGENT_RUNNER_BUILD=auto ^
    -e NO_SUDO=1 ^
    -e HOST_UID=0 ^
    -e HOST_GID=0 ^
    -v "%ROOT_DIR%:/workspace" ^
    -w /workspace ^
    "%IMAGE_NAME%" ^
    -lc "sandbox/image/build.sh"

if %ERRORLEVEL% neq 0 (
    echo.
    echo 错误：镜像构建失败。
    exit /b 1
)

echo.
echo [3/3] 构建完成！
echo.

REM 检查输出
if exist "%ROOT_DIR%\sandbox\image\out\linux-amd64.qcow2" (
    echo   输出文件：sandbox\image\out\linux-amd64.qcow2
    for %%A in ("%ROOT_DIR%\sandbox\image\out\linux-amd64.qcow2") do echo   文件大小：%%~zA 字节
)
if exist "%ROOT_DIR%\sandbox\image\out\linux-arm64.qcow2" (
    echo   输出文件：sandbox\image\out\linux-arm64.qcow2
    for %%A in ("%ROOT_DIR%\sandbox\image\out\linux-arm64.qcow2") do echo   文件大小：%%~zA 字节
)

echo.
echo 下一步：运行 "python scripts\upload-sandbox-image.py" 上传到 CDN。
echo.

endlocal
