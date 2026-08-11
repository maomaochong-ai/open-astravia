import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignSystem } from "../design-systems/types";

/**
 * 一套体系的 HTML demo 预览。
 *
 * 静态时是按比例缩小的整页快照；悬停时页面自动滚动，长页面从头滚到底再滚回来。
 *
 * 三个实现取舍：
 * - **缩放用 transform**，不是改 iframe 宽度：demo 始终按桌面宽度布局，不会被卡片宽度
 *   触发响应式断点变成手机版。
 * - **滚动用 CSS animation 平移 iframe**，不是每帧改 srcDoc（那会让 iframe 反复重载）
 *   也不是 rAF + setState（每帧重渲染）。动画交给合成器，静止的卡片零开销。
 * - **sandbox 只给 allow-same-origin**：脚本执行权一律不给，所以远端 HTML 做不了任何
 *   事；同源只是为了量出内容真实高度，决定该滚多远。源仓库那边还禁掉了 `<script>` 与
 *   外链，两道合起来才算数。
 */
export interface DesignSystemDemoProps {
	system: DesignSystem;
	/** 悬停时才滚动：一屏 20 多张卡片同时动只会让人眼花。 */
	active: boolean;
	className?: string;
}

/** demo 按这个宽度布局，再整体缩放进卡片。桌面断点以上，避免落进移动端样式。 */
const DEMO_WIDTH = 1280;
/** 卡片里露出的可视高度（demo 坐标系内），配合 4:3 左右的卡片比例。 */
const VIEWPORT_HEIGHT = 960;

const SCROLL_PIXELS_PER_SECOND = 110;
/** 最短/最长滚动时长：太快看不清，太慢像卡住。 */
const MIN_DURATION_MS = 2500;
const MAX_DURATION_MS = 14000;

export function designSystemDemoHtml(system: DesignSystem): string | null {
	const demo = system.resources.find((resource) => resource.role === "demo");
	return demo?.encoding === "text" ? demo.content : null;
}

export function DesignSystemDemo({ system, active, className }: DesignSystemDemoProps) {
	const html = designSystemDemoHtml(system);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const [scale, setScale] = useState(0.2);
	const [contentHeight, setContentHeight] = useState(VIEWPORT_HEIGHT);

	// 缩放比例跟着卡片宽度走：卡片宽度由 CSS 网格决定，不是固定值。
	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const measure = (): void => {
			if (box.clientWidth > 0) setScale(box.clientWidth / DEMO_WIDTH);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	}, []);

	const onFrameLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
		// 没有 allow-scripts，量不到就退回单屏（不滚动），不影响静态预览。
		const doc = event.currentTarget.contentDocument;
		const height = doc?.documentElement?.scrollHeight ?? 0;
		if (height > 0) setContentHeight(height);
	}, []);

	if (!html) return null;

	const distance = Math.max(0, contentHeight - VIEWPORT_HEIGHT);
	const duration = Math.min(
		MAX_DURATION_MS,
		Math.max(MIN_DURATION_MS, (distance / SCROLL_PIXELS_PER_SECOND) * 1000),
	);
	const animationName = `vetd-demo-scroll-${system.id.replace(/[^a-z0-9-]/g, "")}`;

	return (
		<div
			ref={boxRef}
			className={`relative overflow-hidden bg-white ${className ?? ""}`}
			// 预览是纯装饰：可读信息（名称、标语、分类）在卡片下半部分。
			aria-hidden
		>
			{distance > 0 ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: 关键帧由本文件生成，唯一变量是已清洗的 id 与数字
				<style
					dangerouslySetInnerHTML={{
						__html: `@keyframes ${animationName}{from{transform:translateY(0)}to{transform:translateY(-${distance}px)}}`,
					}}
				/>
			) : null}
			<div
				className="absolute left-0 top-0 origin-top-left overflow-hidden"
				style={{ width: DEMO_WIDTH, height: VIEWPORT_HEIGHT, transform: `scale(${scale})` }}
			>
				<iframe
					title=""
					sandbox="allow-same-origin"
					srcDoc={html}
					scrolling="no"
					onLoad={onFrameLoad}
					className="pointer-events-none block border-0"
					style={{
						width: DEMO_WIDTH,
						height: contentHeight,
						...(active && distance > 0
							? { animation: `${animationName} ${duration}ms ease-in-out infinite alternate` }
							: {}),
					}}
				/>
			</div>
		</div>
	);
}
