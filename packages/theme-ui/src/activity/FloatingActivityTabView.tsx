import { type ComponentType, type JSX, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useRef } from "react";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";

export interface FloatingActivityTabViewRect {
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}

export interface FloatingActivityTabViewProps {
	readonly Frame: ComponentType<ActivityPanelFrameProps>;
	readonly children: ReactNode;
	readonly onFocus: () => void;
	readonly onResize: (delta: { x: number; y: number }) => void;
	readonly onResizeEnd: () => void;
	readonly rect: FloatingActivityTabViewRect;
	readonly tabBar: ReactNode;
	readonly zIndex: number;
}

function CornerResizeHandle({
	onResize,
	onResizeEnd,
}: Pick<FloatingActivityTabViewProps, "onResize" | "onResizeEnd">): JSX.Element {
	const lastPointRef = useRef({ x: 0, y: 0 });

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>): void => {
			event.preventDefault();
			event.stopPropagation();
			lastPointRef.current = { x: event.clientX, y: event.clientY };

			const overlay = document.createElement("div");
			overlay.dataset.floatingTabResizeOverlay = "";
			overlay.style.position = "fixed";
			overlay.style.inset = "0";
			overlay.style.zIndex = "9999";
			overlay.style.cursor = "nwse-resize";
			const previousUserSelect = document.body.style.userSelect;

			const onPointerMove = (pointerEvent: PointerEvent): void => {
				pointerEvent.preventDefault();
				const previous = lastPointRef.current;
				lastPointRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY };
				onResize({ x: pointerEvent.clientX - previous.x, y: pointerEvent.clientY - previous.y });
			};
			const finishResize = (): void => {
				overlay.removeEventListener("pointermove", onPointerMove);
				overlay.removeEventListener("pointerup", finishResize);
				overlay.removeEventListener("pointercancel", finishResize);
				window.removeEventListener("blur", finishResize);
				overlay.remove();
				document.body.style.userSelect = previousUserSelect;
				onResizeEnd();
			};

			overlay.addEventListener("pointermove", onPointerMove);
			overlay.addEventListener("pointerup", finishResize);
			overlay.addEventListener("pointercancel", finishResize);
			window.addEventListener("blur", finishResize);
			document.body.appendChild(overlay);
			document.body.style.userSelect = "none";
		},
		[onResize, onResizeEnd],
	);

	return (
		<div
			aria-hidden
			onPointerDown={onPointerDown}
			className="group absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize"
		>
			<div className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-border transition-colors group-hover:border-primary" />
		</div>
	);
}

export function FloatingActivityTabView({
	Frame,
	children,
	onFocus,
	onResize,
	onResizeEnd,
	rect,
	tabBar,
	zIndex,
}: FloatingActivityTabViewProps): JSX.Element {
	return (
		<section
			data-floating-activity-tab
			onPointerDown={onFocus}
			className="fixed flex min-h-0 flex-col"
			style={{
				left: rect.x,
				top: rect.y,
				width: rect.width,
				height: rect.height,
				zIndex,
			}}
		>
			<div className="group/activity-tabs relative z-20 flex h-8 shrink-0 items-end">{tabBar}</div>
			<Frame className="shadow-xl">{children}</Frame>
			<CornerResizeHandle onResize={onResize} onResizeEnd={onResizeEnd} />
		</section>
	);
}
