#!/usr/bin/env python3
"""
上传沙箱虚拟机镜像到 Luna NOS CDN。

用法:
    python scripts/upload-sandbox-image.py [--arch amd64|arm64|all] [--input-dir PATH]

此脚本的功能:
1. 从 sandbox/image/out/ 目录读取已构建的 qcow2 镜像文件
2. 将镜像上传到 Luna NOS CDN（内容分发网络）
3. 打印 CDN URL，用于更新 coworkSandboxRuntime.ts 配置文件

环境变量:
    LUNA_NOS_URL: Luna NOS 上传接口地址
    LUNA_NOS_PRODUCT: 产品名称标识符
"""

import os
import sys
import hashlib
import argparse
import requests

# ============================================================================
# 全局配置常量
# ============================================================================

# Luna NOS 上传接口 URL，从环境变量获取
LUNA_NOS_URL = os.environ.get("LUNA_NOS_URL", "")

# Luna NOS 产品标识，从环境变量获取
LUNA_NOS_PRODUCT = os.environ.get("LUNA_NOS_PRODUCT", "")

# Luna NOS 接口成功返回码
LUNA_NOS_SUCCESS_CODE = 0

# 获取脚本所在目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 获取项目根目录（脚本目录的上一级）
ROOT_DIR = os.path.dirname(SCRIPT_DIR)

# 默认输入目录：项目根目录下的 sandbox/image/out/
DEFAULT_INPUT_DIR = os.path.join(ROOT_DIR, "sandbox", "image", "out")


def sha256_file(file_path: str) -> str:
    """
    计算文件的 SHA256 哈希值。
    
    使用分块读取方式处理大文件，避免内存溢出。
    
    参数:
        file_path: 要计算哈希值的文件路径
        
    返回:
        str: 文件的 SHA256 哈希值（十六进制字符串）
    
    示例:
        >>> hash_value = sha256_file("/path/to/file.qcow2")
        >>> print(hash_value)
        'a1b2c3d4e5f6...'
    """
    # 创建 SHA256 哈希对象
    h = hashlib.sha256()
    
    # 以二进制模式打开文件
    with open(file_path, "rb") as f:
        # 分块读取文件，每次读取 8192 字节（8KB）
        while True:
            chunk = f.read(8192)
            # 如果读取到文件末尾，退出循环
            if not chunk:
                break
            # 更新哈希值
            h.update(chunk)
    
    # 返回十六进制格式的哈希值
    return h.hexdigest()


def upload_file(file_path: str) -> str | None:
    """
    上传文件到 Luna NOS 并返回 CDN URL。
    
    此函数会将指定的文件上传到 Luna NOS CDN 服务，
    并返回上传成功后的 CDN 访问 URL。
    
    参数:
        file_path: 要上传的文件路径
        
    返回:
        str | None: 上传成功返回 CDN URL，失败返回 None
    
    异常:
        不会抛出异常，所有错误都会被捕获并打印错误信息
        
    示例:
        >>> url = upload_file("/path/to/image.qcow2")
        >>> if url:
        ...     print(f"上传成功: {url}")
        ... else:
        ...     print("上传失败")
    """
    # 获取文件名（不含路径）
    file_name = os.path.basename(file_path)
    
    # 获取文件大小（字节）
    file_size = os.path.getsize(file_path)

    # 根据文件扩展名确定 MIME 类型
    # MIME 类型用于告诉服务器文件的格式
    if file_name.endswith(".qcow2"):
        # qcow2 是 QEMU 虚拟机镜像格式，使用通用的二进制流类型
        media_type = "application/octet-stream"
    elif file_name.endswith(".gz"):
        # .gz 是 gzip 压缩格式
        media_type = "application/gzip"
    else:
        # 其他文件类型使用通用二进制流类型
        media_type = "application/octet-stream"

    # 打印上传开始信息，显示文件名和大小
    print(f"  正在上传 {file_name} ({file_size:,} 字节)...")

    # 打开文件并上传
    with open(file_path, "rb") as f:
        # 构造 multipart/form-data 格式的文件上传数据
        # files 参数: 文件字段名、文件名、文件对象、MIME 类型
        files = {"file": (file_name, f, media_type)}
        
        # 构造表单数据
        # product: 产品标识
        # useHttps: 是否使用 HTTPS 协议
        data = {"product": LUNA_NOS_PRODUCT, "useHttps": "true"}

        try:
            # 发送 POST 请求上传文件
            # timeout=600: 设置超时时间为 600 秒（10 分钟），适应大文件上传
            response = requests.post(LUNA_NOS_URL, files=files, data=data, timeout=600)
            
            # 检查响应状态码，如果不是 2xx 会抛出异常
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            # 捕获所有请求相关的异常（网络错误、超时、HTTP 错误等）
            print(f"  错误: 上传失败: {e}")
            return None

    # 解析 JSON 响应
    result = response.json()
    
    # 检查返回码是否为成功码
    if result.get("code") == LUNA_NOS_SUCCESS_CODE:
        # 从响应数据中提取 URL
        url = result.get("data", {}).get("url")
        if url:
            # 上传成功，打印 URL
            print(f"  成功: {url}")
            return url
        else:
            # 响应中没有 URL 字段，数据格式异常
            print(f"  错误: 响应中没有 URL: {result}")
            return None
    else:
        # 返回码不是成功码，上传失败
        print(f"  错误: 上传失败 (错误码={result.get('code')}): {result.get('msg')}")
        return None


def main():
    """
    主函数：解析命令行参数并执行上传流程。
    
    此函数完成以下工作:
    1. 解析命令行参数（架构类型、输入目录）
    2. 验证环境变量和输入目录
    3. 遍历指定架构的镜像文件
    4. 计算文件 SHA256 哈希值
    5. 上传文件到 CDN
    6. 输出上传结果和更新代码片段
    
    命令行参数:
        --arch: 指定要上传的架构（amd64、arm64 或 all）
        --input-dir: 指定输入目录路径
    
    退出码:
        0: 成功
        1: 失败（缺少环境变量、目录不存在或上传失败）
    """
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="上传沙箱虚拟机镜像到 CDN")
    
    # 添加 --arch 参数：指定要上传的 CPU 架构
    parser.add_argument(
        "--arch",
        choices=["amd64", "arm64", "all"],  # 可选值
        default="all",  # 默认上传所有架构
        help="要上传的 CPU 架构 (默认: all，即上传所有架构)",
    )
    
    # 添加 --input-dir 参数：指定输入目录
    parser.add_argument(
        "--input-dir",
        default=DEFAULT_INPUT_DIR,  # 默认使用 sandbox/image/out/
        help=f"输入目录 (默认: {DEFAULT_INPUT_DIR})",
    )
    
    # 解析命令行参数
    args = parser.parse_args()

    # 验证必需的环境变量是否已设置
    if not LUNA_NOS_URL or not LUNA_NOS_PRODUCT:
        print("错误: 必须设置环境变量 LUNA_NOS_URL 和 LUNA_NOS_PRODUCT。")
        print("示例:")
        print('  设置 LUNA_NOS_URL=https://your-upload-endpoint/upload')
        print('  设置 LUNA_NOS_PRODUCT=your-product-name')
        sys.exit(1)

    # 获取输入目录路径
    input_dir = args.input_dir
    
    # 检查输入目录是否存在
    if not os.path.isdir(input_dir):
        print(f"错误: 输入目录不存在: {input_dir}")
        print("请先运行构建脚本: scripts\\build-sandbox-image.bat")
        sys.exit(1)

    # 确定要处理的架构列表
    # 如果指定 "all"，则处理 amd64 和 arm64 两种架构
    archs = ["amd64", "arm64"] if args.arch == "all" else [args.arch]
    
    # 存储上传结果的字典
    # 键: 架构名称 (如 "amd64", "arm64")
    # 值: 包含 url 和 sha256 的字典
    results = {}

    # 打印标题横幅
    print("=" * 60)
    print("  上传沙箱虚拟机镜像到 CDN")
    print("=" * 60)
    print()

    # 遍历每个架构进行上传
    for arch in archs:
        # 构造 qcow2 镜像文件路径
        # 文件名格式: linux-{arch}.qcow2
        qcow2_path = os.path.join(input_dir, f"linux-{arch}.qcow2")
        
        # 检查文件是否存在
        if not os.path.isfile(qcow2_path):
            print(f"[{arch}] 已跳过: 未找到文件 {qcow2_path}")
            continue

        # 计算文件的 SHA256 哈希值（用于校验文件完整性）
        file_hash = sha256_file(qcow2_path)
        
        # 打印文件信息
        print(f"[{arch}] 文件: {qcow2_path}")
        print(f"[{arch}] SHA256: {file_hash}")

        # 上传文件到 CDN
        url = upload_file(qcow2_path)
        
        if url:
            # 上传成功，保存结果
            results[arch] = {"url": url, "sha256": file_hash}
        else:
            # 上传失败
            print(f"[{arch}] 上传失败")

        print()

    # 检查是否有成功上传的镜像
    if not results:
        print("没有成功上传任何镜像。")
        sys.exit(1)

    # 打印上传结果摘要
    print("=" * 60)
    print("  上传结果摘要")
    print("=" * 60)
    print()

    # 遍历结果，打印每个架构的 URL 和 SHA256
    for arch, info in results.items():
        print(f"  {arch}:")
        print(f"    URL:    {info['url']}")
        print(f"    SHA256: {info['sha256']}")
        print()

    # 打印需要更新的代码片段
    print("-" * 60)
    print("  请在 src/main/libs/coworkSandboxRuntime.ts 中更新以下内容:")
    print("-" * 60)
    print()

    # 输出 ARM64 架构的 URL 常量定义
    if "arm64" in results:
        print(f"const DEFAULT_SANDBOX_IMAGE_URL_ARM64 = '{results['arm64']['url']}';")
    
    # 输出 AMD64 架构的 URL 常量定义
    if "amd64" in results:
        print(f"const DEFAULT_SANDBOX_IMAGE_URL_AMD64 = '{results['amd64']['url']}';")

    print()
    print("完成！")


# Python 程序入口点
# 只有当此文件作为主程序运行时才会执行 main() 函数
# 如果被其他模块导入，则不会自动执行
if __name__ == "__main__":
    main()
