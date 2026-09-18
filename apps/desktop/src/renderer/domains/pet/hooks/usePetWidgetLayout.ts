import { type RefObject, useEffect, useRef } from "react";
import type { PetContentBounds, PetContentOffset, PetVideoHitbox } from "../../../../shared/pet-ipc";
import { clientRectToHitbox, measurePetWidgetContent, samePetContentBounds, samePetHitbox } from "./pet-widget-content";

export function usePetWidgetLayout({
	shellRef,
	videoRef,
	contentOffset,
}: {
	shellRef: RefObject<HTMLElement | null>;
	videoRef: RefObject<HTMLElement | null>;
	contentOffset: PetContentOffset;
}): void {
	const lastHitboxRef = useRef<PetVideoHitbox | undefined>(undefined);
	const lastContentRef = useRef<PetContentBounds | undefined>(undefined);
	const contentOffsetRef = useRef(contentOffset);
	const reportRef = useRef<(() => void) | undefined>(undefined);
	const { x: offsetX, y: offsetY } = contentOffset;

	useEffect(() => {
		const report = () => {
			const viewport = { width: window.innerWidth, height: window.innerHeight };
			const videoEl = videoRef.current;
			const shellEl = shellRef.current;
			if (shellEl) {
				const shellRect = shellEl.getBoundingClientRect();
				const videoRect = videoEl?.getBoundingClientRect();
				const content = measurePetWidgetContent({
					shell: shellRect,
					video: videoRect && videoRect.width > 0 && videoRect.height > 0 ? videoRect : undefined,
					contentOffset: contentOffsetRef.current,
				});
				if (!samePetContentBounds(lastContentRef.current, content)) {
					lastContentRef.current = content;
					void window.vettaPet?.setContentSize(content);
				}
			}

			const videoHitbox = videoEl ? clientRectToHitbox(videoEl.getBoundingClientRect(), viewport) : undefined;
			if (!samePetHitbox(lastHitboxRef.current, videoHitbox)) {
				lastHitboxRef.current = videoHitbox;
				void window.vettaPet?.setVideoHitbox(videoHitbox);
			}
		};
		reportRef.current = report;

		const observer = new ResizeObserver(report);
		if (shellRef.current) observer.observe(shellRef.current);
		if (videoRef.current) observer.observe(videoRef.current);
		report();
		window.addEventListener("resize", report);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", report);
			reportRef.current = undefined;
			lastHitboxRef.current = undefined;
			lastContentRef.current = undefined;
			void window.vettaPet?.setVideoHitbox(undefined);
		};
	}, [shellRef, videoRef]);

	// 水平平移只改 transform、不改尺寸，ResizeObserver 不会触发；
	// 但主进程要靠这次上报确认布局已同步，且 hitbox 的视口位置也变了。
	useEffect(() => {
		contentOffsetRef.current = { x: offsetX, y: offsetY };
		reportRef.current?.();
	}, [offsetX, offsetY]);
}
