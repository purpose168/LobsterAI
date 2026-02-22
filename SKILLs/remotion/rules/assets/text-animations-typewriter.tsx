import {
	AbsoluteFill,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

// 背景颜色
const COLOR_BG = '#ffffff';
// 文本颜色
const COLOR_TEXT = '#000000';
// 完整文本内容
const FULL_TEXT = 'From prompt to motion graphics. This is Remotion.';
// 暂停位置文本
const PAUSE_AFTER = 'From prompt to motion graphics.';
// 字体大小
const FONT_SIZE = 72;
// 字体粗细
const FONT_WEIGHT = 700;
// 每个字符占用的帧数
const CHAR_FRAMES = 2;
// 光标闪烁周期帧数
const CURSOR_BLINK_FRAMES = 16;
// 暂停时长（秒）
const PAUSE_SECONDS = 1;

// 理想合成尺寸：1280x720

/**
 * 获取打字机效果的文本
 * 根据当前帧计算应该显示的文本内容
 * @param frame - 当前帧数
 * @param fullText - 完整文本
 * @param pauseAfter - 暂停位置的文本
 * @param charFrames - 每个字符占用的帧数
 * @param pauseFrames - 暂停的帧数
 * @returns 当前应该显示的文本
 */
const getTypedText = ({
	frame,
	fullText,
	pauseAfter,
	charFrames,
	pauseFrames,
}: {
	frame: number;
	fullText: string;
	pauseAfter: string;
	charFrames: number;
	pauseFrames: number;
}): string => {
	// 找到暂停位置的索引
	const pauseIndex = fullText.indexOf(pauseAfter);
	// 计算暂停前的文本长度
	const preLen =
		pauseIndex >= 0 ? pauseIndex + pauseAfter.length : fullText.length;

	// 计算已输入的字符数
	let typedChars = 0;
	if (frame < preLen * charFrames) {
		// 暂停前的输入阶段
		typedChars = Math.floor(frame / charFrames);
	} else if (frame < preLen * charFrames + pauseFrames) {
		// 暂停阶段
		typedChars = preLen;
	} else {
		// 暂停后的继续输入阶段
		const postPhase = frame - preLen * charFrames - pauseFrames;
		typedChars = Math.min(
			fullText.length,
			preLen + Math.floor(postPhase / charFrames),
		);
	}
	// 返回当前应该显示的文本片段
	return fullText.slice(0, typedChars);
};

/**
 * 光标组件
 * 实现闪烁的光标效果
 * @param frame - 当前帧数
 * @param blinkFrames - 闪烁周期帧数
 * @param symbol - 光标符号，默认为实心竖线
 */
const Cursor: React.FC<{
	frame: number;
	blinkFrames: number;
	symbol?: string;
}> = ({frame, blinkFrames, symbol = '\u258C'}) => {
	// 根据帧数计算光标透明度，实现闪烁效果
	const opacity = interpolate(
		frame % blinkFrames,
		[0, blinkFrames / 2, blinkFrames],
		[1, 0, 1],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	return <span style={{opacity}}>{symbol}</span>;
};

/**
 * 打字机动画组件
 * 实现文本逐字显示并带有闪烁光标的打字机效果
 */
export const MyAnimation = () => {
	// 获取当前帧数
	const frame = useCurrentFrame();
	// 获取视频配置（帧率等）
	const {fps} = useVideoConfig();

	// 计算暂停帧数
	const pauseFrames = Math.round(fps * PAUSE_SECONDS);

	// 获取当前应该显示的文本
	const typedText = getTypedText({
		frame,
		fullText: FULL_TEXT,
		pauseAfter: PAUSE_AFTER,
		charFrames: CHAR_FRAMES,
		pauseFrames,
	});

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLOR_BG,
			}}
		>
			<div
				style={{
					color: COLOR_TEXT,
					fontSize: FONT_SIZE,
					fontWeight: FONT_WEIGHT,
					fontFamily: 'sans-serif',
				}}
			>
				<span>{typedText}</span>
				<Cursor frame={frame} blinkFrames={CURSOR_BLINK_FRAMES} />
			</div>
		</AbsoluteFill>
	);
};
