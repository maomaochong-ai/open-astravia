import { useTranslation } from "@vetta-org/plugin-sdk";
import { Slider } from "@vetta/ui";
import { useCallback, useEffect, useRef, useState } from "react";

interface ContentVideoPreviewProps {
	src: string;
}

export function ContentVideoPreview({ src }: ContentVideoPreviewProps) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);

	useEffect(() => {
		setPlaying(false);
		setCurrentTime(0);
		setDuration(0);
		return () => videoRef.current?.pause();
	}, [src]);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) {
			void video.play().catch(() => setPlaying(false));
			return;
		}
		video.pause();
	}, []);

	const handleSeek = useCallback((values: number[]) => {
		const video = videoRef.current;
		const next = values[0];
		if (!video || next === undefined) return;
		video.currentTime = next;
		setCurrentTime(next);
	}, []);

	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		video.muted = !video.muted;
		setMuted(video.muted);
	}, []);

	const enterFullscreen = useCallback(() => {
		void containerRef.current?.requestFullscreen?.();
	}, []);

	return (
		<div ref={containerRef} className="group/video relative h-full w-full bg-background" data-content-video-preview>
			<video
				ref={videoRef}
				className="pointer-events-none block h-full w-full border-0 object-contain"
				src={src}
				preload="metadata"
				draggable={false}
				onLoadedMetadata={(event) => setDuration(normalizeMediaTime(event.currentTarget.duration))}
				onDurationChange={(event) => setDuration(normalizeMediaTime(event.currentTarget.duration))}
				onTimeUpdate={(event) => setCurrentTime(normalizeMediaTime(event.currentTarget.currentTime))}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
			/>
			<div
				className="nodrag nowheel pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-2 pt-6 text-white"
				data-content-video-controls
			>
				<VideoControlButton
					label={t(playing ? "action.pause" : "action.play")}
					icon={playing ? "icon-[lucide--pause]" : "icon-[lucide--play]"}
					onClick={togglePlay}
				/>
				<span className="w-16 shrink-0 text-center text-[10px] tabular-nums text-white/85">
					{formatMediaTime(currentTime)} / {formatMediaTime(duration)}
				</span>
				<Slider
					className="min-w-0 flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:bg-white/30"
					value={[Math.min(currentTime, duration || currentTime)]}
					min={0}
					max={duration > 0 ? duration : 1}
					step={0.1}
					disabled={duration <= 0}
					aria-label={t("action.seekVideo")}
					onValueChange={handleSeek}
				/>
				<VideoControlButton
					label={t(muted ? "action.unmute" : "action.mute")}
					icon={muted ? "icon-[lucide--volume-x]" : "icon-[lucide--volume-2]"}
					onClick={toggleMute}
				/>
				<VideoControlButton
					label={t("action.fullscreen")}
					icon="icon-[lucide--maximize]"
					onClick={enterFullscreen}
				/>
			</div>
		</div>
	);
}

function VideoControlButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
	return (
		<button
			type="button"
			className="grid size-7 shrink-0 place-items-center rounded-md text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
			title={label}
			aria-label={label}
			onClick={onClick}
		>
			<span className={`${icon} block size-4`} aria-hidden="true" />
		</button>
	);
}

function normalizeMediaTime(value: number): number {
	return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatMediaTime(value: number): string {
	const seconds = Math.floor(normalizeMediaTime(value));
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
