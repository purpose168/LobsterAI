# ============================================================
#  步骤 1: 安装 WSL2 (需要管理员权限)
#  以管理员身份运行此脚本 (右键点击 PowerShell -> 以管理员身份运行)
# ============================================================

chcp 65001 > $null

# 不要使用 Stop — 原生命令写入 stderr 会导致脚本中止
# 设置错误操作首选项为 Continue,确保脚本在遇到非终止性错误时继续执行
$ErrorActionPreference = "Continue"

# 显示脚本标题信息
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  安装 WSL2 用于沙箱镜像构建" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否以管理员身份运行
# 获取当前 Windows 用户身份并检查是否具有管理员角色
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# 如果不是管理员身份,显示错误信息并退出
if (-not $isAdmin) {
    Write-Host "错误: 此脚本必须以管理员身份运行。" -ForegroundColor Red
    Write-Host ""
    Write-Host "请右键点击 PowerShell 并选择"以管理员身份运行"," -ForegroundColor Yellow
    Write-Host "然后再次运行此脚本。" -ForegroundColor Yellow
    Write-Host ""
    pause  # 暂停等待用户按键
    exit 1  # 退出脚本,返回错误代码 1
}

# 检查 WSL 是否已经正常工作
# 将 stderr 重定向到 $null 以避免 PowerShell 将其视为终止性错误
$wslCheck = $null
try {
    # 尝试获取 WSL 版本信息,将错误输出重定向到 null
    $wslCheck = & wsl --version 2>$null
} catch {
    # 如果发生异常,将检查结果设置为 null
    $wslCheck = $null
}

# 判断 WSL 是否已安装:退出代码为 0 且检查结果不为 null
$wslInstalled = ($LASTEXITCODE -eq 0) -and ($wslCheck -ne $null)

# 如果 WSL 已安装,显示版本信息并检查 Ubuntu 发行版
if ($wslInstalled) {
    Write-Host "WSL 已安装!" -ForegroundColor Green
    & wsl --version 2>$null  # 显示 WSL 版本信息

    # 检查是否已安装 Ubuntu 发行版
    $distros = & wsl --list --quiet 2>$null  # 获取已安装的发行版列表
    $hasUbuntu = $false  # 初始化 Ubuntu 安装标志为 false
    
    # 遍历发行版列表,检查是否包含 Ubuntu
    if ($distros) {
        foreach ($d in $distros) {
            if ($d -match "Ubuntu") { 
                $hasUbuntu = $true  # 找到 Ubuntu,设置标志为 true
                break  # 跳出循环
            }
        }
    }

    # 根据是否已安装 Ubuntu 执行不同操作
    if ($hasUbuntu) {
        Write-Host ""
        Write-Host "Ubuntu 已安装。您可以继续构建。" -ForegroundColor Green
        Write-Host "运行: scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
        pause  # 暂停等待用户按键
        exit 0  # 正常退出脚本
    } else {
        # Ubuntu 未安装,执行安装
        Write-Host ""
        Write-Host "正在安装 Ubuntu 22.04..." -ForegroundColor Yellow
        & wsl --install -d Ubuntu-22.04 --no-launch 2>&1  # 安装 Ubuntu 22.04 但不启动
        Write-Host ""
        Write-Host "Ubuntu 已安装。请重启计算机,然后运行:" -ForegroundColor Green
        Write-Host "  scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
        pause  # 暂停等待用户按键
        exit 0  # 正常退出脚本
    }
}

# WSL 未安装 — 执行安装
Write-Host "WSL 未安装。正在安装 WSL2 和 Ubuntu 22.04..." -ForegroundColor Yellow
Write-Host "这可能需要几分钟时间。" -ForegroundColor Gray
Write-Host ""

# 执行 WSL 安装命令,安装 Ubuntu 22.04
& wsl --install -d Ubuntu-22.04 2>&1

# 检查安装是否成功
if ($LASTEXITCODE -ne 0) {
    # 自动安装失败,尝试手动启用功能
    Write-Host ""
    Write-Host "自动安装未成功,尝试手动启用功能..." -ForegroundColor Yellow
    Write-Host ""

    # 启用 Windows Subsystem for Linux 功能
    Write-Host "正在启用适用于 Linux 的 Windows 子系统..." -ForegroundColor Gray
    & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart 2>&1

    # 启用虚拟机平台功能
    Write-Host "正在启用虚拟机平台..." -ForegroundColor Gray
    & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart 2>&1

    Write-Host ""
    Write-Host "WSL 功能已启用。重启后,请以管理员身份打开 PowerShell 并运行:" -ForegroundColor Yellow
    Write-Host "  wsl --install -d Ubuntu-22.04" -ForegroundColor Yellow
}

# 显示安装完成信息
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  WSL2 安装已启动!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "重要提示: 您必须重启计算机才能完成 WSL2 的设置。" -ForegroundColor Red
Write-Host ""
Write-Host "重启后:" -ForegroundColor Yellow
Write-Host "  1. Ubuntu 可能会自动打开以完成设置" -ForegroundColor Yellow
Write-Host "     (根据提示创建用户名/密码)" -ForegroundColor Yellow
Write-Host "  2. 然后运行: scripts\build-sandbox-in-wsl.bat" -ForegroundColor Yellow
Write-Host ""
pause  # 暂停等待用户按键
