import { cn } from "@shared/lib/utils";
import { motion } from "motion/react";
import {
	BRICK_SPRITE,
	MUSHROOM_SPRITE,
	type PixelSprite,
	QUESTION_SPRITE,
	SPRITE_SIZE,
} from "./mario-sprites";

export interface PixelMarioBlocksProps {
	/** 蘑菇是否用弹出动画顶出来；关掉就直接就位，位置与动画终点一致。 */
	readonly animate?: boolean;
	readonly className?: string;
	/** 蘑菇顶出来没有。没顶出来时它藏在问号砖块背后，问号砖块保持满的样子。 */
	readonly popped: boolean;
	/** 每个像素格的边长（CSS 像素）；一块砖是 16 格，整排就是 48 格。 */
	readonly unit: number;
}

/**
 * 像素马里奥砖块：砖块 - 问号砖块 - 砖块 一排，蘑菇从中间那块背后顶出来。
 *
 * 只画砖块，不带交互与定位——顶不顶得出来、摆在哪儿由用的人决定（新会话页装饰件见
 * MarioOrnament，设置页预览卡直接给个小 unit）。素材是 SVG 矩形而不是 box-shadow：
 * 装饰件和预览卡差着三倍大小，box-shadow 的坐标是写死的像素、换尺寸得重写一遍。
 * 纯装饰，对辅助技术整体隐藏。
 */
export function PixelMarioBlocks({
	animate = false,
	className,
	popped,
	unit,
}: PixelMarioBlocksProps): JSX.Element {
	const block = SPRITE_SIZE * unit;

	return (
		<span
			aria-hidden
			className={cn("ns-mario relative inline-flex", className)}
			data-animate={animate ? "true" : "false"}
			data-popped={popped ? "true" : "false"}
			style={{ height: block, width: block * 3 }}
		>
			{/* 蘑菇压在砖块下一层，没顶出来时正好被问号砖块整块盖住。 */}
			<motion.span
				animate={popped ? { opacity: 1, y: -block * 1.05 } : { opacity: 0, y: 0 }}
				className="absolute bottom-0 z-0"
				initial={false}
				style={{ left: block }}
				transition={animate ? { type: "spring", stiffness: 320, damping: 18 } : { duration: 0 }}
			>
				<Sprite sprite={MUSHROOM_SPRITE} unit={unit} />
			</motion.span>
			<span className="relative z-10 inline-flex">
				<Sprite sprite={BRICK_SPRITE} unit={unit} />
				{/* 顶空了的问号砖块暗一档：没有「空砖块」的素材，用亮度示意它已经被顶过。 */}
				<Sprite
					className="transition-[filter] duration-300"
					sprite={QUESTION_SPRITE}
					style={{ filter: popped ? "brightness(0.55)" : "none" }}
					unit={unit}
				/>
				<Sprite sprite={BRICK_SPRITE} unit={unit} />
			</span>
		</span>
	);
}

function Sprite({
	className,
	sprite,
	style,
	unit,
}: {
	className?: string;
	sprite: PixelSprite;
	style?: React.CSSProperties;
	unit: number;
}): JSX.Element {
	const size = SPRITE_SIZE * unit;
	return (
		<svg
			className={className}
			height={size}
			// 按格子坐标画，缩放交给 viewBox；crispEdges 保证放大后边缘还是硬的。
			shapeRendering="crispEdges"
			style={style}
			viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
			width={size}
		>
			{sprite.rects.map((rect) => (
				<rect
					fill={rect.fill}
					height={1}
					key={`${rect.x}-${rect.y}`}
					width={rect.w}
					x={rect.x}
					y={rect.y}
				/>
			))}
		</svg>
	);
}
