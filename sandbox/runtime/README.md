# 沙箱运行时 (macOS)

此文件夹包含用于构建 Cowork 内置虚拟机沙箱所使用的**运行时包**的辅助脚本。运行时是主机端的 QEMU 二进制文件及其依赖的动态库 (dylibs) 和数据文件。它**不**包含在虚拟机镜像中。

## 环境要求

- macOS
- Homebrew
- QEMU: `brew install qemu`
- dylibbundler: `brew install dylibbundler`

## 构建

```bash
# 为当前机器架构构建
bash sandbox/runtime/build-runtime-macos.sh

# 或指定架构
ARCH=arm64 bash sandbox/runtime/build-runtime-macos.sh
ARCH=x64   bash sandbox/runtime/build-runtime-macos.sh
```

### 注意事项

- 建议在匹配的架构上进行构建。
- 在 Apple Silicon 上构建 `x64` 版本时，需要在 `/usr/local` 下安装 x86 版本的 Homebrew，并设置 `BREW_PREFIX=/usr/local`。

## 输出

文件将输出到：

```
sandbox/runtime/out/
  runtime-darwin-arm64.tar.gz
  runtime-darwin-x64.tar.gz
  runtime-darwin-*.tar.gz.sha256
```

## 在应用中使用

将压缩包上传到您的 CDN，并配置以下选项之一：

- `COWORK_SANDBOX_RUNTIME_URL`（单个文件 URL），或
- `COWORK_SANDBOX_BASE_URL` + `COWORK_SANDBOX_RUNTIME_VERSION`

使用基础 URL 时，应用期望的文件路径为：

```
${BASE_URL}/${VERSION}/runtime-darwin-arm64.tar.gz
${BASE_URL}/${VERSION}/runtime-darwin-x64.tar.gz
```
