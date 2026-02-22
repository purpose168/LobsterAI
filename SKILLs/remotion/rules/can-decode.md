---
name: can-decode
description: 使用 Mediabunny 检查视频是否可以被浏览器解码
metadata:
  tags: 解码, 验证, 视频, 音频, 兼容性, 浏览器
---

# 检查视频是否可以解码

在尝试播放视频之前，使用 Mediabunny 检查视频是否可以被浏览器解码。

## `canDecode()` 函数

此函数可以复制粘贴到任何项目中。

```tsx
import { Input, ALL_FORMATS, UrlSource } from "mediabunny";

export const canDecode = async (src: string) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src, {
      getRetryDelay: () => null,
    }),
  });

  try {
    await input.getFormat(); // 获取格式信息
  } catch {
    return false; // 如果获取失败，返回 false
  }

  const videoTrack = await input.getPrimaryVideoTrack(); // 获取主视频轨道
  if (videoTrack && !(await videoTrack.canDecode())) {
    return false; // 如果视频轨道存在但无法解码，返回 false
  }

  const audioTrack = await input.getPrimaryAudioTrack(); // 获取主音频轨道
  if (audioTrack && !(await audioTrack.canDecode())) {
    return false; // 如果音频轨道存在但无法解码，返回 false
  }

  return true; // 所有检查通过，返回 true
};
```

## 使用方法

```tsx
const src = "https://remotion.media/video.mp4";
const isDecodable = await canDecode(src);

if (isDecodable) {
  console.log("视频可以解码");
} else {
  console.log("此浏览器无法解码该视频");
}
```

## 使用 Blob

对于文件上传或拖放操作，使用 `BlobSource`：

```tsx
import { Input, ALL_FORMATS, BlobSource } from "mediabunny";

export const canDecodeBlob = async (blob: Blob) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  });

  // 与上述相同的验证逻辑
};
```
