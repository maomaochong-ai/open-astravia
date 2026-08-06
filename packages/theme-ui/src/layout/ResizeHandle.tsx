import { useCallback, useRef, type JSX, type PointerEvent as ReactPointerEvent } from "react";

export interface ResizeHandleProps {
	side: "left" | "right";
	onResize: (delta: number) => void;
	onResizeEnd?: () => void;
}

export function ResizeHandle({ side, onResize, onResizeEnd }: ResizeHandleProps): JSX.Element {
	const startXRef = useRef(0);

	const onPointerDown = useCallback(
		(e: ReactPointerEvent) => {
			e.preventDefault();
			startXRef.current = e.clientX;
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
			overlay.style.cursor = "col-resize";
			document.body.appendChild(overlay);

			const onPointerMove = (ev: PointerEvent) => {
				const delta = ev.clientX - startXRef.current;
				startXRef.current = ev.clientX;
				// "right" handle: drag right grows panel; "left" handle: invert.
				pendingDelta += side === "right" ? delta : -delta;
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
		[side, onResize, onResizeEnd],
	);

	const edge = side === "right" ? "right-0" : "left-0";
	const lineGradient =
		"linear-gradient(to bottom, transparent, color-mix(in srgb, var(--primary) 28%, transparent) 50%, transparent)";
	const glowGradient =
		"linear-gradient(to bottom, transparent, color-mix(in srgb, var(--primary) 15%, transparent) 50%, transparent)";
	const fadeStyle = {
		transition: "opacity 380ms cubic-bezier(0.22, 0.61, 0.36, 1)",
		willChange: "opacity",
	} as const;

	return (
		<div
			onPointerDown={onPointerDown}
			className={`group absolute top-0 bottom-0 z-30 w-[8px] cursor-col-resize ${edge}`}
		>
			<div
				aria-hidden
				className={`pointer-events-none absolute ${edge} top-1/2 h-[55%] w-[5px] -translate-y-1/2 rounded-full opacity-0 blur-[4px] group-hover:opacity-100 group-active:opacity-100`}
				style={{ ...fadeStyle, background: glowGradient }}
			/>
			<div
				aria-hidden
				className={`pointer-events-none absolute ${edge} top-1/2 h-[60%] w-px -translate-y-1/2 opacity-0 group-hover:opacity-100 group-active:opacity-100`}
				style={{ ...fadeStyle, background: lineGradient }}
			/>
		</div>
	);
}
