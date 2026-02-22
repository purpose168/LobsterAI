---
name: display-captions
description: 在 Remotion 中显示字幕，支持 TikTok 风格的分页和单词高亮
metadata:
  tags: captions, subtitles, display, tiktok, highlight
---

# 在 Remotion 中显示字幕

本指南介绍如何在 Remotion 中显示字幕，假设您已经拥有 [`Caption`](https://www.remotion.dev/docs/captions/caption) 格式的字幕。

## 前提条件

阅读[转录音频](transcribe-captions.md)了解如何生成字幕。

首先，需要安装 [`@remotion/captions`](https://www.remotion.dev/docs/captions) 包。
如果尚未安装，请使用以下命令：

```bash
npx remotion add @remotion/captions
```

## 获取字幕

首先，获取您的字幕 JSON 文件。使用 [`useDelayRender()`](https://www.remotion.dev/docs/use-delay-render) 暂停渲染，直到字幕加载完成：

```tsx
import { useState, useEffect, useCallback } from "react";
import { AbsoluteFill, staticFile, useDelayRender } from "remotion";
import type { Caption } from "@remotion/captions";

export const MyComponent: React.FC = () => {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender());

  const fetchCaptions = useCallback(async () => {
    try {
      // 假设 captions.json 位于 public/ 文件夹中
      const response = await fetch(staticFile("captions123.json"));
      const data = await response.json();
      setCaptions(data);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, cancelRender, handle]);

  useEffect(() => {
    fetchCaptions();
  }, [fetchCaptions]);

  if (!captions) {
    return null;
  }

  return <AbsoluteFill>{/* 在此处渲染字幕 */}</AbsoluteFill>;
};
```

## 创建分页

使用 `createTikTokStyleCaptions()` 将字幕分组为页面。`combineTokensWithinMilliseconds` 选项控制一次显示多少个单词：

```tsx
import { useMemo } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption } from "@remotion/captions";

// 字幕切换频率（以毫秒为单位）
// 值越高 = 每页显示的单词越多
// 值越低 = 每页显示的单词越少（更逐字显示）
const SWITCH_CAPTIONS_EVERY_MS = 1200;

const { pages } = useMemo(() => {
  return createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
  });
}, [captions]);
```

## 使用 Sequence 渲染

遍历页面并在 `<Sequence>` 中渲染每一页。根据页面时间计算起始帧和持续时间：

```tsx
import { Sequence, useVideoConfig, AbsoluteFill } from "remotion";
import type { TikTokPage } from "@remotion/captions";

const CaptionedContent: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_CAPTIONS_EVERY_MS / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;

        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence
            key={index}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
```

## 保留空白字符

字幕对空白字符敏感。您应该在 `text` 字段中每个单词前包含空格。使用 `whiteSpace: "pre"` 来保留字幕中的空白字符。

## 单独的字幕组件

将字幕逻辑放在单独的组件中。
为其创建一个新文件。

## 单词高亮

字幕页面包含 `tokens`，您可以使用它来高亮当前正在朗读的单词：

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { TikTokPage } from "@remotion/captions";

const HIGHLIGHT_COLOR = "#39E508";

const CaptionPage: React.FC<{ page: TikTokPage }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 相对于序列开始的当前时间
  const currentTimeMs = (frame / fps) * 1000;
  // 通过添加页面开始时间转换为绝对时间
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontSize: 80, fontWeight: "bold", whiteSpace: "pre" }}>
        {page.tokens.map((token) => {
          const isActive =
            token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;

          return (
            <span
              key={token.fromMs}
              style={{ color: isActive ? HIGHLIGHT_COLOR : "white" }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

## 与视频内容一起显示字幕

默认情况下，将字幕与视频内容一起放置，以保持字幕同步。
对于每个视频，创建一个新的字幕 JSON 文件。

```tsx
<AbsoluteFill>
  <Video src={staticFile("video.mp4")} />
  <CaptionPage page={page} />
</AbsoluteFill>
```
