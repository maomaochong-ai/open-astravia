import { useReducedMotion } from "motion/react";
import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@shared/lib/utils";

/**
 * 动态网格背景（Gravity Grid）：
 * - 网格由交叉的网格线组成；
 * - 光标靠近时，线条被轻轻拉向指针（引力井的余韵），幅度小、无颜色变化；
 * - 点击并按住拖拽时形成引力涡旋：以指针为涡心，周围线条被拉向涡心，
 *   呈漏斗状汇聚并带轻微切向旋转（涡旋感）；位移按距涡心的比例限幅，
 *   保持网格结构、线条不缠绕、不塌成一点；涡心处亮度微增、向外迅速衰减；
 *   松开后缓慢回弹（无涟漪、无波前传播）；
 * - 颜色读取 CSS 变量 `--primary`（canvas 无法解析 var()，通过 probe 元素取计算色），
 *   主题切换（class / data-theme / data-mode 变化）时自动刷新；
 * - 四周边缘用宽缓的 CSS mask 渐隐，与背景主题自然融入；四角叠加
 *   backdrop-filter 模糊（mask 限定只在四角生效），网格过渡更柔和。
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
/** 光标把线条拉向指针的最大位移（CSS 像素），幅度小、只做引力余韵。 */
const CURSOR_PULL = 10;
/** 拖拽涡旋影响半径（CSS 像素）。 */
const DRAG_RADIUS = 240;
/** 涡心相对抓取点的最大偏移（CSS 像素），限制拖拽幅度。 */
const DRAG_MAX_OFFSET = 90;
/** 涡旋最大径向拉力（CSS 像素），向内汇聚的强度。 */
const DRAG_PULL = 52;
/** 位移不超过距涡心距离的比例：线条向涡心汇聚但不会塌成一点。 */
const DRAG_CLAMP = 0.55;
/** 切向分量与径向拉力的比例，形成涡旋旋转感。 */
const DRAG_SWIRL = 0.3;
/** 涡心处亮度增益（向外以 (1-t)³ 迅速衰减），单色、不渐变到亮色。 */
const DRAG_GAIN = 0.6;
/** 按下时位移平滑拉起速度（1/秒）。 */
const DRAG_RISE = 15;
/** 松开后回弹衰减速度（1/秒），指数衰减；较慢，保留「凹痕缓缓复原」的触感。 */
const DRAG_FALL = 5;
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

		// 网格采样：垂直线（固定 x、y 采样）、水平线（固定 y、x 采样）。
		let verticals: GridPoint[][] = [];
		let horizontals: GridPoint[][] = [];

		const rebuildGrid = (): void => {
			verticals = [];
			horizontals = [];
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
		 * bright 为 1 表示正常亮度，拖拽涡心附近 >1（微增，向外迅速衰减）。
		 */
		const pointEffect = (
			px: number,
			py: number,
		): { ox: number; oy: number; bright: number } => {
			let ox = 0;
			let oy = 0;
			let bright = 1;

			// 光标：把点轻轻拉向指针（引力井的余韵），幅度小、无亮度变化。
			// 拖拽进行中（dragging）时暂停该效果，避免与涡旋互相抵消。
			const dc = Math.hypot(px - smoothed.x, py - smoothed.y);
			if (!dragging && dc < waveRadius && dc > 0.01) {
				const k = 1 - dc / waveRadius;
				const falloff = Math.sin(k * Math.PI) * k;
				ox -= ((px - smoothed.x) / dc) * CURSOR_PULL * falloff;
				oy -= ((py - smoothed.y) / dc) * CURSOR_PULL * falloff;
			}

			// 拖拽引力涡旋：线条被拉向涡心（指针），呈漏斗状汇聚；
			// 位移按距涡心的比例限幅，网格保持结构、不缠绕、不塌成一点；
			// 叠加轻微切向分量形成旋转感；亮度只在涡心微增并迅速衰减。
			if (drag) {
				const cx = drag.x + drag.ox;
				const cy = drag.y + drag.oy;
				const dx = px - cx;
				const dy = py - cy;
				const dd = Math.hypot(dx, dy);
				if (dd < DRAG_RADIUS && dd > 0.01) {
					const t = dd / DRAG_RADIUS;
					const falloff = (1 - t) * (1 - t);
					let pull = DRAG_PULL * falloff;
					if (pull > dd * DRAG_CLAMP) {
						pull = dd * DRAG_CLAMP;
					}
					const ux = dx / dd;
					const uy = dy / dd;
					ox -= ux * pull;
					oy -= uy * pull;
					ox += -uy * pull * DRAG_SWIRL;
					oy += ux * pull * DRAG_SWIRL;
					bright += DRAG_GAIN * (1 - t) * (1 - t) * (1 - t);
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
					"radial-gradient(ellipse 120% 110% at 50% 44%, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.18) 74%, rgba(0,0,0,0.1) 88%, rgba(0,0,0,0.06) 100%)",
				WebkitMaskImage:
					"radial-gradient(ellipse 120% 110% at 50% 44%, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.18) 74%, rgba(0,0,0,0.1) 88%, rgba(0,0,0,0.06) 100%)",
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			{/* 四角模糊：backdrop-filter 把四角网格模糊成柔和雾状，mask 限制只在四角生效 */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0"
				style={{
					backdropFilter: "blur(14px)",
					WebkitBackdropFilter: "blur(14px)",
					maskImage:
						"radial-gradient(ellipse 120% 110% at 50% 44%, transparent 55%, rgba(0,0,0,0.55) 74%, #000 88%)",
					WebkitMaskImage:
						"radial-gradient(ellipse 120% 110% at 50% 44%, transparent 55%, rgba(0,0,0,0.55) 74%, #000 88%)",
				}}
			/>
		</div>
	);
}
