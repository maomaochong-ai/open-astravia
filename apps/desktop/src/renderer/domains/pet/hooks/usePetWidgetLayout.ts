import { type RefObject, useEffect, useRef } from "react";
import type { PetContentBounds, PetVideoHitbox } from "../../../../shared/pet-ipc";
import { clientRectToHitbox, measurePetWidgetContent, samePetContentBounds, samePetHitbox } from "./pet-widget-content";

export function usePetWidgetLayout({
	shellRef,
	videoRef,
}: {
	shellRef: RefObject<HTMLElement | null>;
	videoRef: RefObject<HTMLElement | null>;
}): void {
	const lastHitboxRef = useRef<PetVideoHitbox | undefined>(undefined);
	const lastContentRef = useRef<PetContentBounds | undefined>(undefined);

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

		const observer = new ResizeObserver(report);
		if (shellRef.current) observer.observe(shellRef.current);
		if (videoRef.current) observer.observe(videoRef.current);
		report();
		window.addEventListener("resize", report);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", report);
			lastHitboxRef.current = undefined;
			lastContentRef.current = undefined;
			void window.vettaPet?.setVideoHitbox(undefined);
		};
	}, [shellRef, videoRef]);
}
