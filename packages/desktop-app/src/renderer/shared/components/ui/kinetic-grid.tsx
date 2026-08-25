import { useReducedMotion } from "motion/react";
import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@shared/lib/utils";

/**
 * 动态网格背景（Kinetic Grid，参考 shadcn kinetic-grid）：
 * - 网格由交叉的网格线组成，交叉处绘制小圆点；
 * - 光标靠近时，线条与点被平滑推开（远离指针），形成向指针弯曲的变形；
 * - 点击并按住网格时产生拖拽变形：以按点为抓取点，周围一定半径内的
 *   线条与点作为一个整体跟随指针平移（保持网格自身结构、线条不缠绕），
 *   边缘按距离平滑衰减融入，影响范围内呈主题色渐变；松开后平滑回弹
 *   （无涟漪、无波前传播）；
 * - 颜色读取 CSS 变量 `--primary`（canvas 无法解析 var()，通过 probe 元素取计算色），
 *   主题切换（class / data-theme / data-mode 变化）时自动刷新；
 * - 四周边缘用宽缓的 CSS mask 渐隐，与背景主题自然融入。
 * 遵循 DESIGN.md：颜色不硬编码、线条 1px、reduced-motion 时只画一帧静态网格。
 */
export interface KineticGridProps {
	className?: string;
	/** 网格间距（CSS 像素）。 */
	gridSize?: number;
	/** 光标的影响半径（CSS 像素）。 */
	waveRadius?: number;
}

const DEFAULT_GRID_SIZE = 32;
const DEFAULT_WAVE_RADIUS = 260;

/** 网格线基础透明度（叠加在 --primary 之上）。 */
const LINE_ALPHA = 0.06;
/** 网格点基础透明度。 */
const DOT_ALPHA = 0.3;
/** 网格点基础半径（CSS 像素）。 */
const DOT_RADIUS = 1.0;
/** 光标推开线条/点的最大位移（CSS 像素）。 */
const CURSOR_PUSH = 22;
/** 拖拽变形影响半径（CSS 像素）。 */
const DRAG_RADIUS = 200;
/** 拖拽位移上限（CSS 像素），限制幅度避免变形过猛。 */
const DRAG_MAX_OFFSET = 72;
/** 拖拽影响范围内的亮度增益（渐变色，中心最强、向外衰减）。 */
const DRAG_GAIN = 1.4;
/** 按下时位移平滑拉起速度（1/秒）。 */
const DRAG_RISE = 15;
/** 松开后回弹衰减速度（1/秒），指数衰减、干净无过冲。 */
const DRAG_FALL = 9;
interface GridPoint {
	x: number;
	y: number;
}

interface DragState {
	x: number; // 抓取点（按下位置，固定）
	y: number;
	ox: number; // 当前位移向量（世界坐标）
	oy: number;
}

let probe: HTMLDivElement | null = null;

/** 读取 CSS 变量解析后的 rgb 三元组；失败返回 null。 */
function readTokenRgb(varName: string): [number, number, number] | null {
	if (typeof document === "undefined") {
		return null;
	}
	if (!probe) {
		probe = document.createElement("div");
		probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";
		document.body.appendChild(probe);
	}
	probe.style.backgroundColor = `var(${varName})`;
	const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(getComputedStyle(probe).backgroundColor);
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toRgba(rgb: [number, number, number], alpha: number): string {
	return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function KineticGrid({
	className,
	gridSize = DEFAULT_GRID_SIZE,
	waveRadius = DEFAULT_WAVE_RADIUS,
}: KineticGridProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const reduceMotion = useReducedMotion();

	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		let width = 0;
		let height = 0;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		let rgb = readTokenRgb("--primary") ?? [99, 102, 241];
		let cursor = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
		let smoothed = { ...cursor };
		let drag: DragState | null = null;
		let dragging = false;
		let last = performance.now();
		let raf = 0;

		// 网格采样：垂直线（固定 x、y 采样）、水平线（固定 y、x 采样）与交叉点。
		let verticals: GridPoint[][] = [];
		let horizontals: GridPoint[][] = [];
		let dots: GridPoint[] = [];

		const rebuildGrid = (): void => {
			verticals = [];
			horizontals = [];
			dots = [];
			const step = gridSize / 4;
			for (let x = gridSize / 2; x < width; x += gridSize) {
				const line: GridPoint[] = [];
				for (let y = 0; y <= height; y += step) {
					line.push({ x, y });
				}
				verticals.push(line);
			}
			for (let y = gridSize / 2; y < height; y += gridSize) {
				const line: GridPoint[] = [];
				for (let x = 0; x <= width; x += step) {
					line.push({ x, y });
				}
				horizontals.push(line);
			}
			for (let vi = 0; vi < verticals.length; vi++) {
				const vx = verticals[vi][0].x;
				for (let hi = 0; hi < horizontals.length; hi++) {
					const hy = horizontals[hi][0].y;
					dots.push({ x: vx, y: hy });
				}
			}
		};

		const resize = (): void => {
			width = container.clientWidth;
			height = container.clientHeight;
			canvas.width = Math.max(1, Math.round(width * dpr));
			canvas.height = Math.max(1, Math.round(height * dpr));
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			rebuildGrid();
		};

		const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
			const rect = container.getBoundingClientRect();
			return { x: clientX - rect.left, y: clientY - rect.top };
		};

		/**
		 * 计算采样点在光标与拖拽作用下的位移与亮度。
		 * bright 为 1 表示正常亮度，拖拽影响范围内 >1（变亮、主题色渐变）。
		 */
		const pointEffect = (
			px: number,
			py: number,
		): { ox: number; oy: number; bright: number } => {
			let ox = 0;
			let oy = 0;
			let bright = 1;

			// 光标：把点从指针处推开（方向远离指针），强度随距离平滑衰减。
			// 拖拽进行中（dragging）时暂停该效果，避免与拖拽变形互相抵消。
			const dc = Math.hypot(px - smoothed.x, py - smoothed.y);
			if (!dragging && dc < waveRadius && dc > 0.01) {
				const k = 1 - dc / waveRadius;
				const falloff = Math.sin(k * Math.PI) * k;
				ox += ((px - smoothed.x) / dc) * CURSOR_PUSH * falloff;
				oy += ((py - smoothed.y) / dc) * CURSOR_PUSH * falloff;
			}

			// 拖拽变形：影响半径内的点/线作为一个整体跟随位移向量平移，
			// 边缘按 (1 - d/R)² 平滑衰减到 0，保持网格结构、线条不缠绕；
			// 位移与亮度同源衰减，呈主题色渐变。无涟漪：无波前传播，
			// 整个影响区同时、持续变形。
			if (drag) {
				const dd = Math.hypot(px - drag.x, py - drag.y);
				if (dd < DRAG_RADIUS) {
					const t = dd / DRAG_RADIUS;
					const falloff = (1 - t) * (1 - t);
					ox += drag.ox * falloff;
					oy += drag.oy * falloff;
					bright += DRAG_GAIN * falloff;
				}
			}

			return { ox, oy, bright };
		};

		/** 绘制一条采样折线：按亮度相近合并连续段，避免逐点切换 strokeStyle。 */
		const strokeLine = (points: GridPoint[]): void => {
			if (points.length < 2) {
				return;
			}
			// 计算所有采样点的位移与亮度。
			const samples: { x: number; y: number; bright: number }[] = new Array(points.length);
			for (let i = 0; i < points.length; i++) {
				const p = points[i];
				const { ox, oy, bright } = pointEffect(p.x, p.y);
				samples[i] = { x: p.x + ox, y: p.y + oy, bright };
			}
			// 亮度相近的相邻段合并为一条路径。
			let segStart = 0;
			let segBright = samples[0].bright;
			const flush = (end: number): void => {
				ctx.strokeStyle = toRgba(rgb, LINE_ALPHA * segBright);
				ctx.beginPath();
				ctx.moveTo(samples[segStart].x, samples[segStart].y);
				for (let i = segStart + 1; i < end; i++) {
					ctx.lineTo(samples[i].x, samples[i].y);
				}
				ctx.stroke();
			};
			for (let i = 1; i < samples.length; i++) {
				if (Math.abs(samples[i].bright - segBright) > 0.07) {
					flush(i);
					segStart = i;
					segBright = samples[i].bright;
				}
			}
			flush(samples.length);
		};

		const draw = (): void => {
			const now = performance.now();
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;

			// 光标平滑跟随。
			smoothed.x += (cursor.x - smoothed.x) * 0.18;
			smoothed.y += (cursor.y - smoothed.y) * 0.18;

			// 拖拽场：按下时位移向量跟随指针（相对抓取点、限幅、平滑拉起），
			// 松开后指数衰减回弹到 0 并移除。
			if (drag) {
				if (dragging) {
					const dx = cursor.x - drag.x;
					const dy = cursor.y - drag.y;
					const dist = Math.hypot(dx, dy);
					const scale = dist > DRAG_MAX_OFFSET ? DRAG_MAX_OFFSET / dist : 1;
					const step = Math.min(dt * DRAG_RISE, 1);
					drag.ox += (dx * scale - drag.ox) * step;
					drag.oy += (dy * scale - drag.oy) * step;
				} else {
					const decay = Math.exp(-DRAG_FALL * dt);
					drag.ox *= decay;
					drag.oy *= decay;
					if (Math.hypot(drag.ox, drag.oy) < 0.4) {
						drag = null;
					}
				}
			}

			ctx.clearRect(0, 0, width, height);
			ctx.lineWidth = 1;

			for (let i = 0; i < verticals.length; i++) {
				strokeLine(verticals[i]);
			}
			for (let i = 0; i < horizontals.length; i++) {
				strokeLine(horizontals[i]);
			}

			// 交叉点：拖拽增益同步放大半径与 alpha，让渐变色在点上同样可见。
			for (let i = 0; i < dots.length; i++) {
				const d = dots[i];
				const { ox, oy, bright } = pointEffect(d.x, d.y);
				const r = DOT_RADIUS * (1 + 0.8 * (bright - 1));
				ctx.fillStyle = toRgba(rgb, DOT_ALPHA * bright);
				ctx.beginPath();
				ctx.arc(d.x + ox, d.y + oy, r, 0, Math.PI * 2);
				ctx.fill();
			}
		};

		const loop = (): void => {
			draw();
			raf = requestAnimationFrame(loop);
		};

		resize();
		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(container);

		const refreshColors = (): void => {
			rgb = readTokenRgb("--primary") ?? rgb;
		};
		const themeObserver = new MutationObserver(refreshColors);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-theme", "data-mode"],
		});

		const onPointerMove = (event: PointerEvent): void => {
			cursor = toLocal(event.clientX, event.clientY);
		};
		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) {
				return;
			}
			const target = event.target as Element | null;
			if (
				target &&
				typeof target.closest === "function" &&
				target.closest("button, input, textarea, select, a, [role='button'], [contenteditable='true']")
			) {
				return;
			}
			const local = toLocal(event.clientX, event.clientY);
			dragging = true;
			drag = { x: local.x, y: local.y, ox: 0, oy: 0 };
		};
		const onPointerUp = (): void => {
			dragging = false;
		};
		const onPointerLeave = (): void => {
			cursor = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
			dragging = false;
		};

		const cleanup = (): void => {
			cancelAnimationFrame(raf);
			resizeObserver.disconnect();
			themeObserver.disconnect();
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointerleave", onPointerLeave);
		};

		if (reduceMotion) {
			// 静态网格一帧，不注册动画与指针反馈。
			draw();
			return cleanup;
		}

		window.addEventListener("pointermove", onPointerMove, { passive: true });
		window.addEventListener("pointerdown", onPointerDown, { passive: true });
		window.addEventListener("pointerup", onPointerUp, { passive: true });
		window.addEventListener("pointerleave", onPointerLeave, { passive: true });

		raf = requestAnimationFrame(loop);
		return cleanup;
	}, [reduceMotion, gridSize, waveRadius]);

	return (
		<div
			ref={containerRef}
			aria-hidden="true"
			className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
			style={{
				maskImage:
					"radial-gradient(ellipse 120% 110% at 50% 44%, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 32%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.12) 74%, rgba(0,0,0,0.04) 88%, transparent 100%)",
				WebkitMaskImage:
					"radial-gradient(ellipse 120% 110% at 50% 44%, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 32%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.12) 74%, rgba(0,0,0,0.04) 88%, transparent 100%)",
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
		</div>
	);
}
