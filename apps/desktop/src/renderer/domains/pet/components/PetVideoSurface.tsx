import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PetVideoDebugBorder } from "./PetDebugOverlay";

function MissingPetVideo(): JSX.Element {
	const { t } = useTranslation("pet");

	return (
		<div className="flex h-[148px] w-[148px] select-none items-center justify-center rounded-full border border-border/50 bg-popover/60 text-center text-[11px] font-medium leading-5 text-muted-foreground shadow-lg">
			{t("video.missingTitle")}
			<br />
			{t("video.missingSubtitle")}
		</div>
	);
}

function releaseVideo(video: HTMLVideoElement): void {
	video.pause();
	video.removeAttribute("src");
	video.load();
}

function loadVideoSource(video: HTMLVideoElement, src: string | undefined, paused: boolean): void {
	releaseVideo(video);
	if (!src) return;
	video.src = src;
	video.load();
	if (!paused) {
		void video.play().catch(() => undefined);
	}
}

export function PetVideoSurface({
	actionDescription,
	debugFrame,
	paused,
	shouldShowVideo,
	videoRef,
	videoSize,
	videoSrc,
	onError,
	onLoadedMetadata,
}: {
	actionDescription: string | undefined;
	debugFrame: boolean;
	paused: boolean;
	shouldShowVideo: boolean;
	videoRef: RefObject<HTMLDivElement | null>;
	videoSize: { width: number; height: number };
	videoSrc: string | undefined;
	onError: () => void;
	onLoadedMetadata: (size: { width: number; height: number }) => void;
}): JSX.Element {
	const videoElRef = useRef<HTMLVideoElement | null>(null);
	const loadedVideoSrcRef = useRef<string | undefined>(undefined);
	const pausedRef = useRef(paused);
	const videoSrcRef = useRef(videoSrc);

	const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
		if (videoElRef.current && videoElRef.current !== element) {
			releaseVideo(videoElRef.current);
			loadedVideoSrcRef.current = undefined;
		}
		videoElRef.current = element;
		if (element) {
			loadVideoSource(element, videoSrcRef.current, pausedRef.current);
			loadedVideoSrcRef.current = videoSrcRef.current;
		}
	}, []);

	// 系统锁屏或休眠时暂停视频解码，解锁或唤醒后恢复。
	useEffect(() => {
		pausedRef.current = paused;
		const video = videoElRef.current;
		if (!video) return;
		if (paused) {
			video.pause();
		} else {
			void video.play().catch(() => undefined);
		}
	}, [paused]);

	useEffect(() => {
		videoSrcRef.current = videoSrc;
		if (loadedVideoSrcRef.current === videoSrc) return;
		const video = videoElRef.current;
		if (!video) return;
		loadVideoSource(video, videoSrc, pausedRef.current);
		loadedVideoSrcRef.current = videoSrc;
	}, [videoSrc]);

	useEffect(() => {
		return () => {
			if (videoElRef.current) {
				releaseVideo(videoElRef.current);
			}
		};
	}, []);

	if (!shouldShowVideo) {
		return <MissingPetVideo />;
	}

	return (
		<div
			ref={videoRef}
			className="relative"
			style={{
				width: `${videoSize.width}px`,
				height: `${videoSize.height}px`,
			}}
		>
			<PetVideoDebugBorder debugFrame={debugFrame} />
			<video
				ref={setVideoElement}
				autoPlay
				loop
				muted
				playsInline
				draggable={false}
				title={actionDescription}
				onLoadedMetadata={(event) => {
					onLoadedMetadata({
						width: event.currentTarget.videoWidth,
						height: event.currentTarget.videoHeight,
					});
				}}
				onError={onError}
				className="pointer-events-none h-full w-full select-none object-contain"
			/>
		</div>
	);
}
