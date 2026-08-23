/**
 * 画布视口（平移 + 缩放）的唯一实现。
 *
 * 编辑态画布（DesignCanvas）与分享包的只读画布（preview/PreviewCanvas）用的是同
 * 一套手感：滚轮平移、Ctrl/⌘+滚轮绕光标无级缩放、托手拖拽、按钮缩放。这些规则里
 * 有几条不是随便写的（见下），两处各写一遍必然漂开，所以收在这里。
 *
 * 关键约束：
 * - 平移途中不进 React state。每个 pointermove / wheel tick 都重渲染的话，画布上
 *   N 个 iframe 的子树会把合成器饿死，整窗口高频闪烁。平移只改 world 层那一个
 *   transform，落定（松手 / 滚停）才回到 state。
 * - 因此 {@link ViewportController.viewportRef} 才是权威值，state 只是「落定后的
 *   快照」，供需要重渲染的东西（反向缩放的标题、手柄）读。
 */
import { type MutableRefObject, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

/**
 * 只取滚轮事件里视口逻辑真正用到的字段。
 *
 * 不直接收 WheelEvent：编辑态画布的滚轮有一半来自跨源 iframe——事件落在 iframe 的
 * 文档上，画布层根本收不到，只能由引擎 bridge 把这几个数值转发出来。
 */
export interface ViewportWheel {
	deltaX: number;
	deltaY: number;
	clientX: number;
	clientY: number;
	ctrlKey: boolean;
	metaKey: boolean;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
/** 按钮缩放的每档倍率。 */
const ZOOM_STEP = 1.2;
/** 滚轮平移停下多久算「落定」，之后才回 state 并持久化。 */
const PAN_SETTLE_MS = 140;

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * 绕定点缩放：`anchor` 是容器内坐标，缩放前后它对应的世界点保持不动。
 * 光标缩放与按钮缩放（锚点取容器中心）共用它。
 */
export function zoomAround(current: Viewport, nextZoom: number, anchorX: number, anchorY: number): Viewport {
	const zoom = clampZoom(nextZoom);
	const scale = zoom / current.zoom;
	return {
		zoom,
		x: anchorX - (anchorX - current.x) * scale,
		y: anchorY - (anchorY - current.y) * scale,
	};
}

/**
 * 让一组内容在容器里「完整可见」的视口。`padding` 是四周留白（屏幕像素）。
 * 内容为空或容器还没量到尺寸时返回 null，调用方保持现状。
 */
export function fitViewport(
	content: { x: number; y: number; width: number; height: number } | null,
	size: { width: number; height: number },
	padding: number,
	maxZoom = 1,
): Viewport | null {
	if (!content || content.width <= 0 || content.height <= 0) return null;
	if (size.width <= 0 || size.height <= 0) return null;
	const usableWidth = Math.max(size.width - padding * 2, 1);
	const usableHeight = Math.max(size.height - padding * 2, 1);
	const zoom = clampZoom(Math.min(usableWidth / content.width, usableHeight / content.height, maxZoom));
	return {
		zoom,
		x: (size.width - content.width * zoom) / 2 - content.x * zoom,
		y: (size.height - content.height * zoom) / 2 - content.y * zoom,
	};
}

interface UseViewportOptions {
	/** 初始视口（编辑态从 manifest.canvas 读回，只读画布进来时 fit 一次）。 */
	initial: Viewport;
	/**
	 * 视口落定时调用一次（松手、滚停、缩放、直接落值）。编辑态用它写回 manifest；
	 * 只读画布不传——分享包不该被预览改写。
	 */
	onCommit?: (viewport: Viewport) => void;
	/**
	 * 实时绘制之后、以及容器尺寸变化之后调用，参数是此刻的权威视口与容器尺寸。
	 * 用于更新按可见范围推导的东西（画布的视口裁剪），这条路不经过 state。
	 *
	 * 尺寸随参数下发而不是让调用方去读 `sizeRef`：那样回调就要依赖本 hook 的返回值，
	 * 而它本身是 hook 的入参，绕不开。
	 */
	onPaint?: (viewport: Viewport, size: { width: number; height: number }) => void;
}

export interface ViewportController {
	/** 落定后的视口快照，需要重渲染的东西读它。 */
	viewport: Viewport;
	/** 权威值，平移途中领先于 state。高频回调（拖拽、吸附换算）读它。 */
	viewportRef: MutableRefObject<Viewport>;
	/** 挂到滚动/指针容器上，视口坐标换算以它的 bounding rect 为基准。 */
	containerRef: RefObject<HTMLDivElement | null>;
	/** 挂到被 transform 的那一层上。 */
	worldRef: RefObject<HTMLDivElement | null>;
	/** 容器像素尺寸，随 ResizeObserver 更新。 */
	sizeRef: MutableRefObject<{ width: number; height: number }>;
	applyWheel: (wheel: ViewportWheel) => void;
	beginPan: (pointerId: number, clientX: number, clientY: number) => void;
	/** 返回 true 表示这次移动被平移消费，调用方不必再做别的。 */
	panMove: (pointerId: number, clientX: number, clientY: number) => boolean;
	endPan: (pointerId: number) => boolean;
	/** 平移进行中（含滚轮平移还没落定）。 */
	isPanning: () => boolean;
	zoomBy: (direction: 1 | -1) => void;
	/** 直接落一个视口（复位、居中、fit）。 */
	commitViewport: (next: Viewport) => void;
	/** 视口坐标 → 世界坐标。 */
	toWorld: (clientX: number, clientY: number) => { x: number; y: number };
	/** world 层的 transform 与反向缩放变量，供调用方拼进 style。 */
	worldTransform: string;
}

export function useViewport({ initial, onCommit, onPaint }: UseViewportOptions): ViewportController {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const worldRef = useRef<HTMLDivElement | null>(null);
	const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
	const [viewport, setViewport] = useState<Viewport>(initial);
	const viewportRef = useRef(viewport);
	/** 平移进行中的实时视口。非 null 时 DOM 上的 transform 由它驱动，state 落后一步。 */
	const panLiveRef = useRef<Viewport | null>(null);
	// 平移途中 viewportRef 才是权威值（滚轮/拖拽逐帧写它、不进 state）。这里无条件回写
	// 会把它打回上一次提交的 state：滚动途中只要有一次重渲染（裁剪范围重算、frame 上报
	// 渲染完成…），下一个滚轮 tick 就从旧位置重算，画布随机弹回起点。
	if (!panLiveRef.current) viewportRef.current = viewport;

	const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const rafRef = useRef<number | null>(null);
	const wheelSettleRef = useRef<number | null>(null);

	// 回调按 ref 取用：调用方给的是内联函数时，不该让每次渲染都重建整套 handler
	// （applyWheel 会被挂进原生 wheel 监听，重建就是一次解绑重绑）。
	const commitRef = useRef(onCommit);
	commitRef.current = onCommit;
	const paintRef = useRef(onPaint);
	paintRef.current = onPaint;

	const commit = useCallback((next: Viewport): void => {
		setViewport(next);
		commitRef.current?.(next);
	}, []);

	const paintViewport = useCallback((next: Viewport): void => {
		const world = worldRef.current;
		if (world) {
			world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
		}
	}, []);

	/** 把高频 pointermove 折叠到每帧一次实际绘制。 */
	const schedulePaint = useCallback((): void => {
		if (rafRef.current !== null) return;
		rafRef.current = window.requestAnimationFrame(() => {
			rafRef.current = null;
			const live = panLiveRef.current;
			if (!live) return;
			paintViewport(live);
			paintRef.current?.(live, sizeRef.current);
		});
	}, [paintViewport]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const observer = new ResizeObserver(() => {
			sizeRef.current = { width: container.clientWidth, height: container.clientHeight };
			paintRef.current?.(panLiveRef.current ?? viewportRef.current, sizeRef.current);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	// 平移途中若因别的原因（内容变化、活动态更新）触发了渲染，React 会用落后的 state
	// 覆盖 transform 把画布弹回去；这里在提交后、绘制前再抹一次实时值。
	useLayoutEffect(() => {
		if (panLiveRef.current) paintViewport(panLiveRef.current);
	});

	useEffect(
		() => () => {
			if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
			if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
		},
		[],
	);

	const clearWheelSettle = useCallback((): void => {
		if (wheelSettleRef.current === null) return;
		window.clearTimeout(wheelSettleRef.current);
		wheelSettleRef.current = null;
	}, []);

	const commitViewport = useCallback(
		(next: Viewport): void => {
			panLiveRef.current = null;
			clearWheelSettle();
			viewportRef.current = next;
			commit(next);
		},
		[clearWheelSettle, commit],
	);

	/** Ctrl/⌘ + wheel → 绕光标无级缩放；普通滚轮 → 平移。 */
	const applyWheel = useCallback(
		(wheel: ViewportWheel): void => {
			const container = containerRef.current;
			if (!container) return;
			const bounds = container.getBoundingClientRect();
			const current = viewportRef.current;
			if (wheel.ctrlKey || wheel.metaKey) {
				const next = zoomAround(
					current,
					current.zoom * Math.exp(-wheel.deltaY * 0.01),
					wheel.clientX - bounds.left,
					wheel.clientY - bounds.top,
				);
				// 缩放要重渲染（frame 标题与手柄按 zoom 反向缩放），走 state。
				// 先撤掉可能还挂着的滚轮平移实时值，否则 layout effect 会拿旧位置盖回去。
				commitViewport(next);
				return;
			}
			// 滚轮平移与托手拖拽同理：走 DOM，不逐事件进 state（触控板两指平移同样高频）。
			// 停下来一小会儿再落 state 与磁盘。
			const next = { ...current, x: current.x - wheel.deltaX, y: current.y - wheel.deltaY };
			viewportRef.current = next;
			panLiveRef.current = next;
			schedulePaint();
			clearWheelSettle();
			wheelSettleRef.current = window.setTimeout(() => {
				wheelSettleRef.current = null;
				const settled = panLiveRef.current;
				if (!settled || dragRef.current) return;
				panLiveRef.current = null;
				commit(settled);
			}, PAN_SETTLE_MS);
		},
		[clearWheelSettle, commit, commitViewport, schedulePaint],
	);

	const beginPan = useCallback((pointerId: number, clientX: number, clientY: number): void => {
		dragRef.current = { pointerId, startX: clientX, startY: clientY, origin: viewportRef.current };
	}, []);

	const panMove = useCallback(
		(pointerId: number, clientX: number, clientY: number): boolean => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== pointerId) return false;
			const next = {
				...drag.origin,
				x: drag.origin.x + (clientX - drag.startX),
				y: drag.origin.y + (clientY - drag.startY),
			};
			viewportRef.current = next;
			panLiveRef.current = next;
			schedulePaint();
			return true;
		},
		[schedulePaint],
	);

	const endPan = useCallback(
		(pointerId: number): boolean => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== pointerId) return false;
			dragRef.current = null;
			if (rafRef.current !== null) {
				window.cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			// 松手才把这一趟平移交回 state：期间 DOM 已经是最终位置，这次渲染不会跳。
			const settled = panLiveRef.current ?? viewportRef.current;
			panLiveRef.current = null;
			commit(settled);
			return true;
		},
		[commit],
	);

	const isPanning = useCallback((): boolean => dragRef.current !== null || panLiveRef.current !== null, []);

	const zoomBy = useCallback(
		(direction: 1 | -1): void => {
			const bounds = containerRef.current?.getBoundingClientRect();
			const current = viewportRef.current;
			const nextZoom = direction === 1 ? current.zoom * ZOOM_STEP : current.zoom / ZOOM_STEP;
			commitViewport(zoomAround(current, nextZoom, (bounds?.width ?? 0) / 2, (bounds?.height ?? 0) / 2));
		},
		[commitViewport],
	);

	const toWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
		const bounds = containerRef.current?.getBoundingClientRect();
		const current = viewportRef.current;
		const localX = clientX - (bounds?.left ?? 0);
		const localY = clientY - (bounds?.top ?? 0);
		return { x: (localX - current.x) / current.zoom, y: (localY - current.y) / current.zoom };
	}, []);

	return {
		viewport,
		viewportRef,
		containerRef,
		worldRef,
		sizeRef,
		applyWheel,
		beginPan,
		panMove,
		endPan,
		isPanning,
		zoomBy,
		commitViewport,
		toWorld,
		worldTransform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
	};
}
