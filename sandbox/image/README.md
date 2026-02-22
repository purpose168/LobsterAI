# 沙箱镜像构建

本目录包含 Cowork 沙箱模式的虚拟机镜像构建流水线。
中文文档请参阅 `README.zh-CN.md`。

## 预期输出

- `linux-amd64.qcow2`
- `linux-arm64.qcow2`

输出文件由 `build.sh` 写入 `sandbox/image/out/` 目录。
Docker 构建脚本在容器内运行 `build.sh`。

## 注意事项

- 镜像应在启动时引导并运行 `agentd` 服务。
- `agentd` 必须：
  - 将主机 IPC 共享（标签 `ipc`）挂载到 `/workspace/ipc`。
  - 将主机工作共享（标签来自请求）挂载到提供的访客路径。
  - 监听 `/workspace/ipc/requests` 并将 JSONL 事件流写入 `/workspace/ipc/streams`。
  - 从 `/workspace/ipc/responses` 读取权限响应。

使用 `sandbox/agent-runner` 源代码作为虚拟机镜像内的 Node 运行时负载。

## Alpine 构建流水线

构建过程使用 Alpine minirootfs，安装运行时依赖（Node、OpenRC、
Linux 内核），并生成一个可通过 GRUB 引导的 qcow2 镜像。

### Agent Runner 负载

将 agent runner 源代码放置在 `sandbox/agent-runner` 下。构建过程会将其复制
到 `/opt/agent-runner` 并（可选）运行：

- `npm ci --omit=dev`
- `npm run build --if-present`

如果您的 runner 使用不同的路径，请更新 `sandbox/image/overlay/etc/conf.d/agentd` 中的
默认入口点。

### 在 macOS 上构建（Docker）

此方式使用 Linux 容器运行构建（需要 Docker Desktop）。

```bash
cd <repo-root>
./scripts/build-sandbox-image-docker.sh
```

如果您在 macOS 上且只需要 Windows 沙箱镜像（`linux-amd64.qcow2`），请运行：

```bash
./scripts/build-sandbox-image-win-on-mac.sh
```

显式选择容器运行时：

```bash
./scripts/build-sandbox-image-win-on-mac.sh --tool docker
./scripts/build-sandbox-image-win-on-mac.sh --tool podman
```

分步操作：
1. 将 agent runner 源代码放入 `sandbox/agent-runner`。
2. 如果 runner 需要构建步骤，请使用以下命令运行 Docker 构建：
   `AGENT_RUNNER_BUILD=1 ./scripts/build-sandbox-image-docker.sh`
3. 在 `sandbox/image/out/` 中确认输出文件。
4. 可选择运行发布脚本（见下文）。

### 构建（指定架构）

```bash
ARCHS=amd64 ./scripts/build-sandbox-image-docker.sh
ARCHS=arm64 ./scripts/build-sandbox-image-docker.sh
```

注意事项：
- 容器以 `--privileged` 运行以允许 `losetup` 和 `mount` 操作。
- 输出文件位于主机的 `sandbox/image/out/` 目录中。
- 构建上下文通过 `.dockerignore` 忽略 `sandbox/image/.work`，以避免
  之前 root 拥有的文件导致的权限错误。

### 架构说明

- Apple Silicon 可以在本地构建 `arm64` 镜像。
- `amd64` 镜像应在 x86_64 主机（或 CI 运行器）上构建。
  默认情况下未启用跨架构构建。

### 发布

构建完成后，运行发布脚本以重命名镜像并生成校验和：

```bash
cd <repo-root>
./scripts/publish-sandbox-image.sh v0.1.0
```

这将在 `sandbox/image/publish/` 下创建一个与应用程序预期的
CDN 布局匹配的版本化目录：

```
sandbox/image/publish/v0.1.0/
image-linux-amd64.qcow2
image-linux-arm64.qcow2
SHA256SUMS
```

### 自定义

- `ALPINE_BRANCH`（默认 `v3.20`）
- `ALPINE_VERSION`（默认 `3.20.3`）
- `IMAGE_SIZE`（默认 `4G`）
- `AGENT_RUNNER_BUILD`（`auto`、`1` 或 `0`）
