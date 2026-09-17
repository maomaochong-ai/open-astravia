import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import type { DesignSystem } from "../design-systems/types";

/**
 * 一套体系的 HTML demo 预览。
 *
 * 静态时是按比例缩小的整页快照；悬停时页面自动滚动，长页面从头滚到底再滚回来。
 *
 * 实现取舍：
 * - **底层永远铺一张 token 色板**，iframe 真正 load 之后才淡入盖上去。iframe 渲染不出来
 *   （被环境拦、还没解析完、srcdoc 太大）时用户看到的是色板，而不是一块黑。
 * - **视口内才挂载 iframe**：一屏 20 多个文档同时解析既慢又没意义，滚动到才建。
 * - **缩放用 transform**，不是改 iframe 宽度：demo 始终按桌面宽度布局，不会被卡片宽度
 *   触发响应式断点变成手机版。
 * - **缩放值只写 DOM，不进 state**：卡片宽度会在侧边栏收缩、窗口拖拽、宫格换列时连续变化，
 *   每次变化都 setState 就是一次重渲染，而这棵子树里还挂着整张色板预览；一屏 25 张卡片
 *   一起来，一次收缩曾实测出 150 次重渲染。改成在 ResizeObserver 回调里直接写 transform，
 *   宽度怎么变都不进 React。
 * - **滚动用 CSS animation 平移 iframe**，不是每帧改 srcDoc（会让 iframe 反复重载）也不是
 *   rAF + setState（每帧重渲染）。动画交给合成器，静止的卡片零开销。
 * - **sandbox 只给 allow-same-origin**：脚本执行权一律不给，远端 HTML 做不了任何事；
 *   同源仅用于量出内容真实高度。源仓库那边还禁掉了 `<script>` 与外链，两道合起来才算数。
 */
export interface DesignSystemDemoProps {
	system: DesignSystem;
	/** 悬停时才滚动：一屏 20 多张卡片同时动只会让人眼花。 */
	active: boolean;
	className?: string;
}

/** demo 按这个宽度布局，再整体缩放进卡片。桌面断点以上，避免落进移动端样式。 */
const DEMO_WIDTH = 1280;
/** 卡片里露出的可视高度（demo 坐标系内）。 */
const VIEWPORT_HEIGHT = 960;

const SCROLL_PIXELS_PER_SECOND = 110;
const MIN_DURATION_MS = 2500;
const MAX_DURATION_MS = 14000;

export function designSystemDemoHtml(system: DesignSystem): string | null {
	const demo = system.resources.find((resource) => resource.role === "demo");
	return demo?.encoding === "text" ? demo.content : null;
}

export function DesignSystemDemo({ system, active, className }: DesignSystemDemoProps) {
	const html = designSystemDemoHtml(system);
	const boxRef = useRef<HTMLDivElement | null>(null);
	/** 当前缩放：只在 DOM 与这个 ref 之间流动，不进 state（见文件头）。 */
	const scaleRef = useRef(0.25);
	const scaledRef = useRef<HTMLDivElement | null>(null);
	const [contentHeight, setContentHeight] = useState(VIEWPORT_HEIGHT);
	/** iframe 真的 load 过一次才认为预览可用；在此之前底层色板一直露着。 */
	const [ready, setReady] = useState(false);
	/** 进过视口才挂载 iframe。 */
	const [mounted, setMounted] = useState(false);

	/** 把当前缩放写到被缩放的那一层上。挂载时机与测量时机都要用，所以单独拎出来。 */
	const applyScale = useCallback((): void => {
		const scaled = scaledRef.current;
		if (scaled) scaled.style.transform = `scale(${scaleRef.current})`;
	}, []);

	// iframe 是滚进视口才挂的，挂上来的那一帧要把此刻的缩放补上。
	useLayoutEffect(applyScale, [applyScale, mounted]);

	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const applyWidth = (width: number): void => {
			if (width <= 0) return;
			scaleRef.current = width / DEMO_WIDTH;
			applyScale();
		};
		applyWidth(box.clientWidth);
		// 回调里用 entry.contentRect，不要再读 clientWidth：一屏 25 张卡「写完这张的
		// transform 再去读下一张的宽度」会把一次尺寸变化变成 25 次强制同步布局。
		const resize = new ResizeObserver((entries) => {
			for (const entry of entries) applyWidth(entry.contentRect.width);
		});
		resize.observe(box);

		const visible = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setMounted(true);
			},
			{ rootMargin: "200px" },
		);
		visible.observe(box);
		return () => {
			resize.disconnect();
			visible.disconnect();
		};
	}, [applyScale]);

	const onFrameLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
		setReady(true);
		// 没有 allow-scripts，量不到就退回单屏（不滚动），不影响静态预览。
		const height = event.currentTarget.contentDocument?.documentElement?.scrollHeight ?? 0;
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
		// w-full 不能省：卡片是 <button>，而 button 的 UA 默认样式带 align-items:center，
		// 交叉轴不会 stretch；这里内部又全是 absolute 子元素，没有 in-flow 内容撑宽，
		// 少了它整块宽度会塌成 0（高度正常，所以表现为「什么都没渲染」）。
		<div
			ref={boxRef}
			className={`relative w-full overflow-hidden ${className ?? ""}`}
			// 悬停激活态落在 DOM 上：滚动动画依赖量出的内容高度，测试环境量不到，
			// 「hover 是否点燃了预览」只能靠这个标记断言。
			data-active={active || undefined}
		>
			{/* 兜底层：iframe 起不来时用户看到的是这套体系的色板，不是一块空白。 */}
			<DesignSystemPreview system={system} className="absolute inset-0" />

			{distance > 0 ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: 关键帧由本文件生成，唯一变量是已清洗的 id 与数字
				<style
					dangerouslySetInnerHTML={{
						__html: `@keyframes ${animationName}{from{transform:translateY(0)}to{transform:translateY(-${distance}px)}}`,
					}}
				/>
			) : null}

			{mounted ? (
				<div
					ref={scaledRef}
					className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white transition-opacity duration-300"
					style={{
						width: DEMO_WIDTH,
						height: VIEWPORT_HEIGHT,
						transform: `scale(${scaleRef.current})`,
						opacity: ready ? 1 : 0,
					}}
					aria-hidden
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
			) : null}
		</div>
	);
}
