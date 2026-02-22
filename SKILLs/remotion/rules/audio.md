---
name: audio
description: 在 Remotion 中使用音频和声音 - 导入、修剪、音量、速度、音调
metadata:
  tags: audio, media, trim, volume, speed, loop, pitch, mute, sound, sfx
---

# 在 Remotion 中使用音频

## 前置条件

首先，需要安装 @remotion/media 包。
如果尚未安装，请使用以下命令：

```bash
npx remotion add @remotion/media
```

## 导入音频

使用 `@remotion/media` 中的 `<Audio>` 组件将音频添加到您的合成中。

```tsx
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Audio src={staticFile("audio.mp3")} />;
};
```

也支持远程 URL：

```tsx
<Audio src="https://remotion.media/audio.mp3" />
```

默认情况下，音频从头开始播放，音量为最大，播放完整长度。
可以通过添加多个 `<Audio>` 组件来叠加多个音轨。

## 修剪

使用 `trimBefore` 和 `trimAfter` 来移除音频的部分内容。值以帧为单位。

```tsx
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    trimBefore={2 * fps} // 跳过前 2 秒
    trimAfter={10 * fps} // 在 10 秒标记处结束
  />
);
```

音频仍然从合成的开始处播放 - 只播放指定的部分。

## 延迟

将音频包裹在 `<Sequence>` 中可以延迟其开始播放的时间：

```tsx
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";

const { fps } = useVideoConfig();

return (
  <Sequence from={1 * fps}>
    <Audio src={staticFile("audio.mp3")} />
  </Sequence>
);
```

音频将在 1 秒后开始播放。

## 音量

设置静态音量（0 到 1）：

```tsx
<Audio src={staticFile("audio.mp3")} volume={0.5} />
```

或者使用回调函数根据当前帧动态设置音量：

```tsx
import { interpolate } from "remotion";

const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    volume={(f) =>
      interpolate(f, [0, 1 * fps], [0, 1], { extrapolateRight: "clamp" })
    }
  />
);
```

`f` 的值从音频开始播放时为 0 开始计算，而不是合成帧。

## 静音

使用 `muted` 属性使音频静音。可以动态设置：

```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    muted={frame >= 2 * fps && frame <= 4 * fps} // 在 2 秒到 4 秒之间静音
  />
);
```

## 速度

使用 `playbackRate` 改变播放速度：

```tsx
<Audio src={staticFile("audio.mp3")} playbackRate={2} /> {/* 2 倍速 */}
<Audio src={staticFile("audio.mp3")} playbackRate={0.5} /> {/* 半速 */}
```

不支持反向播放。

## 循环

使用 `loop` 属性无限循环音频：

```tsx
<Audio src={staticFile("audio.mp3")} loop />
```

使用 `loopVolumeCurveBehavior` 控制循环时帧计数的行为：

- `"repeat"`: 每次循环帧计数重置为 0（默认）
- `"extend"`: 帧计数继续递增

```tsx
<Audio
  src={staticFile("audio.mp3")}
  loop
  loopVolumeCurveBehavior="extend"
  volume={(f) => interpolate(f, [0, 300], [1, 0])} // 在多次循环中淡出
/>
```

## 音调

使用 `toneFrequency` 调整音调而不影响速度。值范围为 0.01 到 2：

```tsx
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={1.5} // 更高的音调
/>
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={0.8} // 更低的音调
/>
```

音调偏移仅在服务端渲染时有效，在 Remotion Studio 预览或 `<Player />` 中不起作用。
