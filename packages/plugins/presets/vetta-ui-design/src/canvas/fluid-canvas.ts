/**
 * frame 活动态的混沌流体背景，画在 canvas 上。
 *
 * 原来是 CSS 做的：五个实色 blob 各自漂移缩放，套在一个带 26px 模糊的旋转层里，外面
 * 再叠 mask 和整组 opacity。父层带 filter、子层每帧都变，模糊结果无从缓存，每一帧
 * 都要对 180% 尺寸的区域重做一遍高斯模糊，frame 越大、同时亮着的越多 GPU 越高。
 *
 * 这里换了三件事：
 * - 画布很小（最长边 CANVAS_MAX_EDGE 像素），由 CSS 拉伸铺满 frame。放大时的双线性
 *   插值本身就是模糊，blob 又是径向渐变画的软边，不需要任何 filter。
 * - 「四周浓、中心淡」的遮罩和整体 60% 不透明度直接画进像素，不走 mask-image / opacity。
 * - 所有亮着的 frame 共用一个 rAF 循环，限到 FRAME_INTERVAL_MS；不在视口里的、画布
 *   正在缩放平移（.vetd-interacting）的，这一轮都跳过。
 */

/** canvas 最长边的像素数。再大看不出差别，只是多传纹理。 */
export const CANVAS_MAX_EDGE = 64;
/** 帧间隔上限（约 24fps）：流体本就慢悠悠的，60fps 纯属浪费。 */
const FRAME_INTERVAL_MS = 1000 / 24;
/** 整层旋转一圈的时长，对齐原来 CSS 版的 36s。 */
const SPIN_PERIOD_MS = 36_000;
/** 整体不透明度：底下的稿子仍隐约可见。 */
const FLUID_ALPHA = 0.6;

/**
 * 五个 blob 的几何，单位是旋转场的边长（场是 frame 最长边的 1.8 倍，任意旋转角都盖满
 * frame）。cx/cy 相对场中心，r 是半径；drift 是漂移周期（ms），相位错开，叠加后无规律流转。
 * 取自原 CSS 版 BLOB_SHAPES 的位置与尺寸。
 */
const BLOBS: { cx: number; cy: number; r: number; drift: number; phase: number }[] = [
	{ cx: -0.275, cy: -0.325, r: 0.375, drift: 5_000, phase: 0 },
	{ cx: 0.4, cy: -0.3, r: 0.35, drift: 6_300, phase: 1.7 },
	{ cx: -0.25, cy: 0.425, r: 0.36, drift: 7_600, phase: 3.4 },
	{ cx: 0.325, cy: 0.35, r: 0.36, drift: 8_900, phase: 5.1 },
	{ cx: 0.025, cy: 0, r: 0.29, drift: 10_200, phase: 6.8 },
];

/** 按 frame 的宽高比给出 canvas 的像素尺寸，最长边 CANVAS_MAX_EDGE。 */
export function fluidCanvasSize(frameWidth: number, frameHeight: number): { width: number; height: number } {
	const w = Math.max(frameWidth, 1);
	const h = Math.max(frameHeight, 1);
	const scale = CANVAS_MAX_EDGE / Math.max(w, h);
	return { width: Math.max(4, Math.round(w * scale)), height: Math.max(4, Math.round(h * scale)) };
}

/** 画一帧。colors 是五个 blob 的颜色（#rrggbb）。 */
export function drawFluid(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	time: number,
	colors: readonly string[],
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.clearRect(0, 0, width, height);

	const field = Math.max(width, height) * 1.8;
	ctx.translate(width / 2, height / 2);
	ctx.rotate(((time % SPIN_PERIOD_MS) / SPIN_PERIOD_MS) * Math.PI * 2);
	for (const [index, blob] of BLOBS.entries()) {
		const t = (time / blob.drift) * Math.PI * 2 + blob.phase;
		// 漂移幅度约为自身尺寸的两成、缩放 0.82～1.22，与原 keyframes 的量级一致。
		const x = (blob.cx + blob.r * 0.22 * Math.sin(t)) * field;
		const y = (blob.cy + blob.r * 0.2 * Math.cos(t * 0.8)) * field;
		const r = blob.r * (1.02 + 0.2 * Math.sin(t * 1.3)) * field;
		const color = colors[index % colors.length] ?? "#6366f1";
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
		gradient.addColorStop(0, color);
		gradient.addColorStop(0.55, `${color}d9`);
		gradient.addColorStop(1, `${color}00`);
		ctx.fillStyle = gradient;
		ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}

	// 遮罩：四周浓、中心淡。边缘紧贴 frame 边框，与画布背景对比最强；中心留出通透区，
	// 稿子主体始终读得到。椭圆 72% × 62%，stop 与原 CSS mask 一致，再整体乘 FLUID_ALPHA。
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "destination-in";
	ctx.translate(width / 2, height / 2);
	ctx.scale(width * 0.72, height * 0.62);
	const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
	mask.addColorStop(0, "rgba(0,0,0,0)");
	mask.addColorStop(0.42, `rgba(0,0,0,${0.22 * FLUID_ALPHA})`);
	mask.addColorStop(0.72, `rgba(0,0,0,${0.72 * FLUID_ALPHA})`);
	mask.addColorStop(1, `rgba(0,0,0,${FLUID_ALPHA})`);
	ctx.fillStyle = mask;
	ctx.fillRect(-2, -2, 4, 4);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
}

interface FluidEntry {
	canvas: HTMLCanvasElement;
	draw(time: number): void;
	visible: boolean;
}

const entries = new Set<FluidEntry>();
let rafId = 0;
let lastFrame = 0;
let observer: IntersectionObserver | null = null;

function entryOf(canvas: Element): FluidEntry | undefined {
	for (const entry of entries) if (entry.canvas === canvas) return entry;
	return undefined;
}

function tick(now: number): void {
	rafId = 0;
	if (entries.size === 0) return;
	if (now - lastFrame >= FRAME_INTERVAL_MS) {
		lastFrame = now;
		for (const entry of entries) {
			if (!entry.visible) continue;
			// 缩放/平移途中不画：那时 world 的 scale 每帧都在变，少一张纹理上传是一张。
			if (entry.canvas.closest(".vetd-interacting")) continue;
			entry.draw(now);
		}
	}
	rafId = requestAnimationFrame(tick);
}

function ensureObserver(): IntersectionObserver | null {
	if (observer || typeof IntersectionObserver === "undefined") return observer;
	observer = new IntersectionObserver((records) => {
		for (const record of records) {
			const entry = entryOf(record.target);
			if (entry) entry.visible = record.isIntersecting;
		}
	});
	return observer;
}

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 把一张流体 canvas 接进共享循环，返回注销函数。先同步画一帧，挂上就有画面；
 * 系统要求减少动效时只画这一帧、不进循环。
 */
export function startFluid(canvas: HTMLCanvasElement, colors: readonly string[]): () => void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return () => {};
	const draw = (time: number): void => drawFluid(ctx, canvas.width, canvas.height, time, colors);
	draw(performance.now());
	if (prefersReducedMotion()) return () => {};

	const entry: FluidEntry = { canvas, draw, visible: true };
	entries.add(entry);
	ensureObserver()?.observe(canvas);
	if (rafId === 0) rafId = requestAnimationFrame(tick);
	return () => {
		entries.delete(entry);
		observer?.unobserve(canvas);
		if (entries.size === 0 && rafId !== 0) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	};
}

/** 当前在循环里的 canvas 数，测试用。 */
export function activeFluidCount(): number {
	return entries.size;
}
