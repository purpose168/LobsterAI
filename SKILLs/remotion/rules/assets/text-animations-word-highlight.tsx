import {loadFont} from '@remotion/google-fonts/Inter';
import React from 'react';
import {
	AbsoluteFill,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

/*
 * 使用弹簧动画擦除效果高亮句子中的单词。
 */

// 理想合成尺寸：1280x720

// 背景颜色
const COLOR_BG = '#ffffff';
// 文本颜色
const COLOR_TEXT = '#000000';
// 高亮颜色
const COLOR_HIGHLIGHT = '#A7C7E7';
// 完整文本
const FULL_TEXT = 'This is Remotion.';
// 高亮单词
const HIGHLIGHT_WORD = 'Remotion';
// 字体大小
const FONT_SIZE = 72;
// 字体粗细
const FONT_WEIGHT = 700;
// 高亮开始帧
const HIGHLIGHT_START_FRAME = 30;
// 高亮擦除持续时间（帧数）
const HIGHLIGHT_WIPE_DURATION = 18;

// 加载字体
const {fontFamily} = loadFont();

/**
 * 高亮组件 - 为单词添加弹簧动画擦除效果
 * @param word - 要高亮的单词
 * @param color - 高亮颜色
 * @param delay - 延迟帧数
 * @param durationInFrames - 动画持续帧数
 */
const Highlight: React.FC<{
	word: string;
	color: string;
	delay: number;
	durationInFrames: number;
}> = ({word, color, delay, durationInFrames}) => {
	// 获取当前帧
	const frame = useCurrentFrame();
	// 获取视频配置（帧率）
	const {fps} = useVideoConfig();

	// 计算高亮进度（使用弹簧动画）
	const highlightProgress = spring({
		fps,
		frame,
		config: {damping: 200},
		delay,
		durationInFrames,
	});
	// 限制缩放值在0-1范围内
	const scaleX = Math.max(0, Math.min(1, highlightProgress));

	return (
		<span style={{position: 'relative', display: 'inline-block'}}>
			{/* 高亮背景层 - 使用 scaleX 动画实现擦除效果 */}
			<span
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: '50%',
					height: '1.05em',
					transform: `translateY(-50%) scaleX(${scaleX})`,
					transformOrigin: 'left center',
					backgroundColor: color,
					borderRadius: '0.18em',
					zIndex: 0,
				}}
			/>
			{/* 单词文本层 */}
			<span style={{position: 'relative', zIndex: 1}}>{word}</span>
		</span>
	);
};

/**
 * 我的动画组件 - 展示带高亮效果的文本动画
 */
export const MyAnimation = () => {
	// 查找高亮单词在文本中的位置
	const highlightIndex = FULL_TEXT.indexOf(HIGHLIGHT_WORD);
	// 判断是否存在高亮单词
	const hasHighlight = highlightIndex >= 0;
	// 获取高亮单词前的文本
	const preText = hasHighlight ? FULL_TEXT.slice(0, highlightIndex) : FULL_TEXT;
	// 获取高亮单词后的文本
	const postText = hasHighlight
		? FULL_TEXT.slice(highlightIndex + HIGHLIGHT_WORD.length)
		: '';

	return (
		{/* 全屏填充容器 */}
		<AbsoluteFill
			style={{
				backgroundColor: COLOR_BG,
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily,
			}}
		>
			{/* 文本容器 */}
			<div
				style={{
					color: COLOR_TEXT,
					fontSize: FONT_SIZE,
					fontWeight: FONT_WEIGHT,
				}}
			>
				{hasHighlight ? (
					<>
						{/* 高亮单词前的文本 */}
						<span>{preText}</span>
						{/* 高亮单词 */}
						<Highlight
							word={HIGHLIGHT_WORD}
							color={COLOR_HIGHLIGHT}
							delay={HIGHLIGHT_START_FRAME}
							durationInFrames={HIGHLIGHT_WIPE_DURATION}
						/>
						{/* 高亮单词后的文本 */}
						<span>{postText}</span>
					</>
				) : (
					// 如果没有高亮单词，显示完整文本
					<span>{FULL_TEXT}</span>
				)}
			</div>
		</AbsoluteFill>
	);
};
