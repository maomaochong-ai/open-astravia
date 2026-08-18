import { type RefObject, useEffect } from "react";

export function usePetHitbox({
	shouldShowVideo,
	videoRef,
}: {
	shouldShowVideo: boolean;
	videoRef: RefObject<HTMLDivElement | null>;
}): void {
	useEffect(() => {
		if (!shouldShowVideo) {
			void window.vettaPet?.setVideoHitbox(undefined);
			return;
		}

		const reportHitbox = () => {
			const bounds = videoRef.current?.getBoundingClientRect();
			if (!bounds) {
				void window.vettaPet?.setVideoHitbox(undefined);
				return;
			}
			const left = Math.max(0, bounds.left);
			const top = Math.max(0, bounds.top);
			const right = Math.min(window.innerWidth, bounds.right);
			const bottom = Math.min(window.innerHeight, bounds.bottom);
			if (right <= left || bottom <= top) {
				void window.vettaPet?.setVideoHitbox(undefined);
				return;
			}
			void window.vettaPet?.setVideoHitbox({
				x: left,
				y: top,
				width: right - left,
				height: bottom - top,
			});
		};
		const observer = new ResizeObserver(reportHitbox);
		if (videoRef.current) {
			observer.observe(videoRef.current);
		}
		reportHitbox();
		window.addEventListener("resize", reportHitbox);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", reportHitbox);
			void window.vettaPet?.setVideoHitbox(undefined);
		};
	}, [shouldShowVideo, videoRef]);
}
