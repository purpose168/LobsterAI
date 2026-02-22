---
name: transparent-videos
description: 在 Remotion 中渲染透明视频
metadata:
  tags: transparent, alpha, codec, vp9, prores, webm
---

# 渲染透明视频

Remotion 可以通过两种方式渲染透明视频：ProRes 视频或 WebM 视频。

## 透明 ProRes

适用于导入到视频编辑软件的场景。

**命令行 (CLI)：**

```bash
npx remotion render --image-format=png --pixel-format=yuva444p10le --codec=prores --prores-profile=4444 MyComp out.mov
```

**Studio 中的默认设置**（更改后需重启 Studio）：

```ts
// remotion.config.ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");      // 设置视频图像格式为 PNG
Config.setPixelFormat("yuva444p10le");  // 设置像素格式
Config.setCodec("prores");              // 设置编码器为 ProRes
Config.setProResProfile("4444");        // 设置 ProRes 配置文件为 4444
```

**将其设置为合成 (composition) 的默认导出设置**（使用 `calculateMetadata`）：

```tsx
import { CalculateMetadataFunction } from "remotion";

const calculateMetadata: CalculateMetadataFunction<Props> = async ({
  props,
}) => {
  return {
    defaultCodec: "prores",               // 默认编码器
    defaultVideoImageFormat: "png",       // 默认视频图像格式
    defaultPixelFormat: "yuva444p10le",   // 默认像素格式
    defaultProResProfile: "4444",         // 默认 ProRes 配置文件
  };
};

<Composition
  id="my-video"
  component={MyVideo}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
  calculateMetadata={calculateMetadata}
/>;
```

## 透明 WebM (VP9)

适用于在浏览器中播放的场景。

**命令行 (CLI)：**

```bash
npx remotion render --image-format=png --pixel-format=yuva420p --codec=vp9 MyComp out.webm
```

**Studio 中的默认设置**（更改后需重启 Studio）：

```ts
// remotion.config.ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");      // 设置视频图像格式为 PNG
Config.setPixelFormat("yuva420p");      // 设置像素格式
Config.setCodec("vp9");                 // 设置编码器为 VP9
```

**将其设置为合成 (composition) 的默认导出设置**（使用 `calculateMetadata`）：

```tsx
import { CalculateMetadataFunction } from "remotion";

const calculateMetadata: CalculateMetadataFunction<Props> = async ({
  props,
}) => {
  return {
    defaultCodec: "vp8",                 // 默认编码器
    defaultVideoImageFormat: "png",      // 默认视频图像格式
    defaultPixelFormat: "yuva420p",      // 默认像素格式
  };
};

<Composition
  id="my-video"
  component={MyVideo}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
  calculateMetadata={calculateMetadata}
/>;
```
