---
name: get-audio-duration
description: 使用 Mediabunny 获取音频文件的时长（以秒为单位）
metadata:
  tags: duration, audio, length, time, seconds, mp3, wav
---

# 使用 Mediabunny 获取音频时长

Mediabunny 可以提取音频文件的时长。它支持浏览器、Node.js 和 Bun 环境。

## 获取音频时长

```tsx
import { Input, ALL_FORMATS, UrlSource } from "mediabunny";

export const getAudioDuration = async (src: string) => {
  const input = new Input({
    formats: ALL_FORMATS,                                // 支持所有格式
    source: new UrlSource(src, {
      getRetryDelay: () => null,                         // 不重试
    }),
  });

  const durationInSeconds = await input.computeDuration(); // 计算时长（秒）
  return durationInSeconds;
};
```

## 使用方法

```tsx
const duration = await getAudioDuration("https://remotion.media/audio.mp3");
console.log(duration); // 例如：180.5（秒）
```

## 处理本地文件

对于本地文件，使用 `FileSource` 代替 `UrlSource`：

```tsx
import { Input, ALL_FORMATS, FileSource } from "mediabunny";

const input = new Input({
  formats: ALL_FORMATS,
  source: new FileSource(file),                          // 来自输入框或拖放的 File 对象
});

const durationInSeconds = await input.computeDuration(); // 计算时长（秒）
```

## 在 Remotion 中使用 staticFile

```tsx
import { staticFile } from "remotion";

const duration = await getAudioDuration(staticFile("audio.mp3"));
```
