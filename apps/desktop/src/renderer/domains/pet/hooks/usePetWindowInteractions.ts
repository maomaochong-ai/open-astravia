import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, type WheelEvent } from "react";
import type { PetActionId } from "../../../../shared/pet-actions";

function isPointOverElement(element: HTMLElement | null, clientX: number, clientY: number): boolean {
	const bounds = element?.getBoundingClientRect();
	return Boolean(
		bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
	);
}

export function usePetWindowInteractions({
	actionId,
	videoRef,
}: {
	actionId: PetActionId | undefined;
	videoRef: RefObject<HTMLDivElement | null>;
}): {
	handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	handlePointerLeave: () => void;
	handlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	handleWheel: (event: WheelEvent<HTMLDivElement>) => void;
} {
	const isDraggingRef = useRef(false);
	const isPointOverVideo = (clientX: number, clientY: number) =>
		isPointOverElement(videoRef.current, clientX, clientY);
	const updateMousePassthrough = (clientX: number, clientY: number) => {
		if (isDraggingRef.current) {
			void window.vettaPet?.setMousePassthrough(false);
			return;
		}
		void window.vettaPet?.setMousePassthrough(!isPointOverVideo(clientX, clientY));
	};

	const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		if (actionId) {
			void window.vettaPet?.resizeVideoByWheel(actionId, event.deltaY);
		}
	};

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const dragTarget = event.currentTarget;
		dragTarget.setPointerCapture(event.pointerId);
		isDraggingRef.current = true;
		void window.vettaPet?.setMousePassthrough(false);
		const moveSessionReady = window.vettaPet?.beginWindowMove() ?? Promise.resolve();
		let dragFinished = false;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			moveEvent.preventDefault();
			void moveSessionReady.then(() => window.vettaPet?.moveWindow());
		};
		const handlePointerUp = () => {
			if (dragFinished) return;
			dragFinished = true;
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
			dragTarget.removeEventListener("lostpointercapture", handleLostPointerCapture);
			isDraggingRef.current = false;
			void moveSessionReady.then(() => window.vettaPet?.endWindowMove());
		};
		const handleLostPointerCapture = (captureEvent: PointerEvent) => {
			if ((captureEvent.buttons & 1) !== 0) return;
			handlePointerUp();
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
		dragTarget.addEventListener("lostpointercapture", handleLostPointerCapture);
	};

	return {
		handlePointerDown,
		handlePointerLeave: () => {
			if (isDraggingRef.current) return;
			void window.vettaPet?.setMousePassthrough(true);
		},
		handlePointerMove: (event) => updateMousePassthrough(event.clientX, event.clientY),
		handleWheel,
	};
}
