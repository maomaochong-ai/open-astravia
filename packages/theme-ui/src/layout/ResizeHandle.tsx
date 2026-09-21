import { useCallback, useRef, type JSX, type PointerEvent as ReactPointerEvent } from "react";

/**
 * `side` 是「把手贴在被拉伸元素的哪条边上」，不是拖拽方向。
 * 语义统一为：正的 delta 让元素变大，所以贴在起始边（left / top）上的把手要取反。
 */
export type ResizeHandleSide = "left" | "right" | "top" | "bottom";

export interface ResizeHandleProps {
	side: ResizeHandleSide;
	onResizeStart?: () => void;
	onResize: (delta: number) => void;
	onResizeEnd?: () => void;
}

export interface ResizeHandleAxis {
	readonly vertical: boolean;
	/** Tailwind 类名必须是字面量，所以光标分成类名与 overlay 用的原始值两份。 */
	readonly cursorClass: string;
	readonly overlayCursor: string;
	readonly edge: string;
	readonly track: string;
	readonly line: string;
	readonly glow: string;
	readonly gradientDirection: string;
}

export function resolveResizeHandleAxis(side: ResizeHandleSide): ResizeHandleAxis {
	if (side === "top" || side === "bottom") {
		return {
			vertical: true,
			cursorClass: "cursor-row-resize",
			overlayCursor: "row-resize",
			edge: side === "top" ? "top-0" : "bottom-0",
			track: "left-0 right-0 h-[8px]",
			line: "h-px w-[60%] left-1/2 -translate-x-1/2",
			glow: "h-[5px] w-[55%] left-1/2 -translate-x-1/2 blur-[4px]",
			gradientDirection: "to right",
		};
	}
	return {
		vertical: false,
		cursorClass: "cursor-col-resize",
		overlayCursor: "col-resize",
		edge: side === "right" ? "right-0" : "left-0",
		track: "top-0 bottom-0 w-[8px]",
		line: "w-px h-[60%] top-1/2 -translate-y-1/2",
		glow: "w-[5px] h-[55%] top-1/2 -translate-y-1/2 blur-[4px]",
		gradientDirection: "to bottom",
	};
}

/**
 * 把指针位移折算成「元素该变大多少」。
 * 贴在起始边（left / top）上的把手要取反：往左/上拖才是变大。
 */
export function resizeHandleDelta(side: ResizeHandleSide, pointerDelta: number): number {
	return side === "right" || side === "bottom" ? pointerDelta : -pointerDelta;
}

export function ResizeHandle({ side, onResizeStart, onResize, onResizeEnd }: ResizeHandleProps): JSX.Element {
	const startRef = useRef(0);
	const axis = resolveResizeHandleAxis(side);

	const onPointerDown = useCallback(
		(e: ReactPointerEvent) => {
			e.preventDefault();
			onResizeStart?.();
			const readPosition = (event: { clientX: number; clientY: number }) =>
				axis.vertical ? event.clientY : event.clientX;
			startRef.current = readPosition(e);
			let pendingDelta = 0;
			let animationFrame: number | null = null;

			const flushResize = () => {
				animationFrame = null;
				if (pendingDelta === 0) return;
				const delta = pendingDelta;
				pendingDelta = 0;
				onResize(delta);
			};

			// Full-screen overlay during drag: independent WebContents (e.g. <webview>)
			// swallow pointer events; overlay keeps move/up on document until release.
			const overlay = document.createElement("div");
			overlay.style.position = "fixed";
			overlay.style.inset = "0";
			overlay.style.zIndex = "9999";
			overlay.style.cursor = axis.overlayCursor;
			document.body.appendChild(overlay);

			const onPointerMove = (ev: PointerEvent) => {
				const position = readPosition(ev);
				const delta = position - startRef.current;
				startRef.current = position;
				pendingDelta += resizeHandleDelta(side, delta);
				if (animationFrame === null) animationFrame = requestAnimationFrame(flushResize);
			};

			const onPointerUp = () => {
				document.removeEventListener("pointermove", onPointerMove);
				document.removeEventListener("pointerup", onPointerUp);
				if (animationFrame !== null) cancelAnimationFrame(animationFrame);
				flushResize();
				overlay.remove();
				document.body.style.userSelect = "";
				onResizeEnd?.();
			};

			document.addEventListener("pointermove", onPointerMove);
			document.addEventListener("pointerup", onPointerUp);
			document.body.style.userSelect = "none";
		},
		[axis.overlayCursor, axis.vertical, side, onResizeStart, onResize, onResizeEnd],
	);

	const lineGradient = `linear-gradient(${axis.gradientDirection}, transparent, color-mix(in srgb, var(--primary) 28%, transparent) 50%, transparent)`;
	const glowGradient = `linear-gradient(${axis.gradientDirection}, transparent, color-mix(in srgb, var(--primary) 15%, transparent) 50%, transparent)`;
	const fadeStyle = {
		transition: "opacity 380ms cubic-bezier(0.22, 0.61, 0.36, 1)",
		willChange: "opacity",
	} as const;

	return (
		<div
			data-resize-handle={side}
			onPointerDown={onPointerDown}
			className={`group absolute z-30 ${axis.cursorClass} ${axis.track} ${axis.edge}`}
		>
			<div
				aria-hidden
				className={`pointer-events-none absolute ${axis.edge} ${axis.glow} rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100`}
				style={{ ...fadeStyle, background: glowGradient }}
			/>
			<div
				aria-hidden
				className={`pointer-events-none absolute ${axis.edge} ${axis.line} opacity-0 group-hover:opacity-100 group-active:opacity-100`}
				style={{ ...fadeStyle, background: lineGradient }}
			/>
		</div>
	);
}
