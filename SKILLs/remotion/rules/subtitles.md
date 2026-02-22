---
name: 字幕
description: 字幕和说明文字规则
metadata:
  tags: 字幕, 说明文字, remotion, json
---

所有字幕必须以 JSON 格式处理。字幕必须使用 `Caption` 类型，该类型定义如下：

```ts
import type { Caption } from "@remotion/captions";
```

这是类型定义：

```ts
type Caption = {
  text: string;           // 字幕文本内容
  startMs: number;        // 开始时间（毫秒）
  endMs: number;          // 结束时间（毫秒）
  timestampMs: number | null;    // 时间戳（毫秒），可为空
  confidence: number | null;     // 置信度，可为空
};
```

## 生成字幕

要转录视频和音频文件以生成字幕，请加载 [./transcribe-captions.md](./transcribe-captions.md) 文件获取详细说明。

## 显示字幕

要在视频中显示字幕，请加载 [./display-captions.md](./display-captions.md) 文件获取详细说明。

## 导入字幕

要从 .srt 文件导入字幕，请加载 [./import-srt-captions.md](./import-srt-captions.md) 文件获取详细说明。
