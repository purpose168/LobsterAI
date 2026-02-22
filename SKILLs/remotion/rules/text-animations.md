---
name: text-animations
description: Remotion 的排版和文本动画模式。
metadata:
  tags: typography, text, typewriter, highlighter ken
---

## 文本动画

基于 `useCurrentFrame()`，逐字符减少字符串以创建打字机效果。

## 打字机效果

请参阅 [Typewriter](assets/text-animations-typewriter.tsx) 查看高级示例，其中包含闪烁光标和首句后的暂停效果。

打字机效果始终使用字符串切片。切勿使用逐字符透明度。

## 单词高亮

请参阅 [Word Highlight](assets/text-animations-word-highlight.tsx) 查看单词高亮动画示例，类似于荧光笔效果。
