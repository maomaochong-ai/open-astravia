import { type PluginAudioMetadata, type PluginPreviewFile, useTranslation } from "@vetta-org/plugin-sdk";
import { Slider } from "@vetta-org/ui";
import { motion } from "motion/react";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn, formatTime, versionedUrl } from "./utils";

const DISC_SPEED = 45;
const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.5, 0.75];
const VISUALIZER_BARS = 48;

export function AudioPreview({ file }: { file: PluginPreviewFile }): JSX.Element {
	const { t } = useTranslation();
	const isLocal = !!file.path;
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const discRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	const [version, setVersion] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [loop, setLoop] = useState(false);
	const [rateIndex, setRateIndex] = useState(0);
	const [meta, setMeta] = useState<PluginAudioMetadata>({});
	const [failed, setFailed] = useState(false);

	const playingRef = useRef(false);
	const rateRef = useRef(1);
	const speedRef = useRef(0);
	const angleRef = useRef(0);
	const rafRef = useRef(0);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

	useEffect(() => {
		setVersion(0);
		setFailed(false);
		const watcher = file.watch(() => {
			setFailed(false);
			setVersion((value) => value + 1);
		});
		return () => watcher.dispose();
	}, [file]);

	useEffect(() => {
		let cancelled = false;
		if (!file.getAudioMetadata) {
			setMeta({});
			return;
		}
		void file.getAudioMetadata().then((result) => {
			if (!cancelled) setMeta(result ?? {});
		});
		return () => {
			cancelled = true;
		};
	}, [file]);

	const drawVisualizer = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const width = canvas.clientWidth * dpr;
		const height = canvas.clientHeight * dpr;
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		const analyser = analyserRef.current;
		if (analyser && freqDataRef.current) analyser.getByteFrequencyData(freqDataRef.current);
		const data = freqDataRef.current;
		const binCount = data ? data.length : 0;
		ctx.fillStyle = getComputedStyle(canvas).color;
		const gap = 2 * dpr;
		const barWidth = (width - gap * (VISUALIZER_BARS - 1)) / VISUALIZER_BARS;
		for (let i = 0; i < VISUALIZER_BARS; i++) {
			let value = 0;
			if (data && binCount > 0) {
				const bin = Math.floor((i / VISUALIZER_BARS) * binCount * 0.7);
				value = (data[bin] ?? 0) / 255;
			}
			const barHeight = Math.max(2 * dpr, value * height);
			const x = i * (barWidth + gap);
			ctx.globalAlpha = 0.25 + value * 0.75;
			ctx.fillRect(x, height - barHeight, barWidth, barHeight);
		}
		ctx.globalAlpha = 1;
	}, []);

	const startLoop = useCallback(() => {
		if (rafRef.current) return;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.1);
			last = now;
			const target = playingRef.current ? DISC_SPEED * rateRef.current : 0;
			speedRef.current += (target - speedRef.current) * Math.min(1, dt * 2.5);
			angleRef.current = (angleRef.current + speedRef.current * dt) % 360;
			if (discRef.current) discRef.current.style.transform = `rotate(${angleRef.current}deg)`;
			drawVisualizer();
			if (playingRef.current || speedRef.current > 0.5) {
				rafRef.current = requestAnimationFrame(tick);
			} else {
				speedRef.current = 0;
				rafRef.current = 0;
				drawVisualizer();
			}
		};
		rafRef.current = requestAnimationFrame(tick);
	}, [drawVisualizer]);

	const ensureAnalyser = useCallback(() => {
		if (!isLocal) return;
		const audio = audioRef.current;
		if (!audio) return;
		if (!audioCtxRef.current) {
			try {
				const ctx = new AudioContext();
				const source = ctx.createMediaElementSource(audio);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 256;
				analyser.smoothingTimeConstant = 0.75;
				source.connect(analyser);
				analyser.connect(ctx.destination);
				audioCtxRef.current = ctx;
				analyserRef.current = analyser;
				freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
			} catch {
				// Visualizer is optional; playback still works without analyser access.
			}
		}
		void audioCtxRef.current?.resume();
	}, [isLocal]);

	useEffect(() => {
		return () => {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = 0;
			audioRef.current?.pause();
			void audioCtxRef.current?.close();
		};
	}, []);

	const togglePlay = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) {
			ensureAnalyser();
			void audio.play().catch(() => setFailed(true));
		} else {
			audio.pause();
		}
	}, [ensureAnalyser]);

	const handleSeek = useCallback((values: number[]) => {
		const audio = audioRef.current;
		const next = values[0];
		if (!audio || next === undefined) return;
		audio.currentTime = next;
		setCurrentTime(next);
	}, []);

	const handleVolume = useCallback((values: number[]) => {
		const audio = audioRef.current;
		const next = values[0];
		if (!audio || next === undefined) return;
		audio.volume = next;
		audio.muted = false;
		setVolume(next);
		setMuted(false);
	}, []);

	const toggleMute = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.muted = !audio.muted;
		setMuted(audio.muted);
	}, []);

	const toggleLoop = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.loop = !audio.loop;
		setLoop(audio.loop);
	}, []);

	const cycleRate = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const next = (rateIndex + 1) % PLAYBACK_RATES.length;
		audio.playbackRate = PLAYBACK_RATES[next] ?? 1;
		rateRef.current = PLAYBACK_RATES[next] ?? 1;
		setRateIndex(next);
	}, [rateIndex]);

	const title = meta.title ?? file.name;
	const rate = PLAYBACK_RATES[rateIndex] ?? 1;
	const src = versionedUrl(file.getUrl({ mediaKind: "audio" }), version);

	if (failed || !src) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground/50">
				<span className="icon-[mdi--music-note-off] text-[40px]" />
				<span className="text-[13px]">{t("audio.error")}</span>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-8">
			<audio
				ref={audioRef}
				src={src}
				preload="metadata"
				crossOrigin={isLocal ? "anonymous" : undefined}
				onPlay={() => {
					playingRef.current = true;
					setPlaying(true);
					startLoop();
				}}
				onPause={() => {
					playingRef.current = false;
					setPlaying(false);
				}}
				onEnded={() => {
					playingRef.current = false;
					setPlaying(false);
				}}
				onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
				onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
				onError={() => setFailed(true)}
			/>

			<div className="relative shrink-0 pt-3">
				<div
					ref={discRef}
					className="relative flex h-52 w-52 items-center justify-center rounded-full bg-neutral-900 shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-black/60 will-change-transform"
					style={{
						backgroundImage:
							"repeating-radial-gradient(circle at center, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 2px, transparent 5px)," +
							"conic-gradient(from 0deg, rgba(255,255,255,0.07) 0deg, transparent 60deg, transparent 180deg, rgba(255,255,255,0.07) 220deg, transparent 300deg)",
					}}
				>
					{meta.coverDataUrl ? (
						<img
							src={meta.coverDataUrl}
							alt={t("audio.coverAlt")}
							draggable={false}
							className="h-24 w-24 rounded-full object-cover ring-2 ring-black/70"
						/>
					) : (
						<div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/90 px-3 ring-2 ring-black/70">
							<span className="line-clamp-2 break-all text-center text-[10px] font-medium leading-tight text-primary-foreground/90">
								{file.name}
							</span>
						</div>
					)}
					<div className="absolute h-2.5 w-2.5 rounded-full bg-neutral-300 shadow-inner ring-1 ring-black/50" />
				</div>

				<motion.div
					className="pointer-events-none absolute -right-3 -top-1 origin-[50%_10px]"
					initial={false}
					animate={{ rotate: playing ? 28 : 0 }}
					transition={{ type: "spring", stiffness: 90, damping: 14 }}
				>
					<div className="mx-auto h-5 w-5 rounded-full bg-neutral-400 shadow ring-1 ring-black/30 dark:bg-neutral-600" />
					<div className="mx-auto h-20 w-1 rounded-full bg-neutral-400 dark:bg-neutral-600" />
					<div className="mx-auto h-6 w-2 rounded-sm bg-neutral-500 shadow dark:bg-neutral-500" />
				</motion.div>
			</div>

			<div className="w-full max-w-md text-center">
				<p className="truncate text-[14px] font-semibold text-foreground" title={title}>
					{title}
				</p>
				{meta.artist && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{meta.artist}</p>}
			</div>

			{isLocal && <canvas ref={canvasRef} className="h-9 w-full max-w-md text-primary" />}

			<div className="flex w-full max-w-md items-center gap-3">
				<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatTime(currentTime)}</span>
				<Slider
					value={[Math.min(currentTime, duration || currentTime)]}
					min={0}
					max={duration > 0 ? duration : 1}
					step={0.1}
					disabled={duration <= 0}
					onValueChange={handleSeek}
				/>
				<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatTime(duration)}</span>
			</div>

			<div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2">
				<ControlButton
					icon="icon-[mdi--repeat]"
					title={loop ? t("audio.loopOff") : t("audio.loopOn")}
					active={loop}
					onClick={toggleLoop}
				/>
				<button
					type="button"
					onClick={togglePlay}
					title={playing ? t("audio.pause") : t("audio.play")}
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105"
				>
					<span className={cn(playing ? "icon-[mdi--pause]" : "icon-[mdi--play]", "h-6 w-6")} />
				</button>
				<button
					type="button"
					onClick={cycleRate}
					title={t("audio.speed")}
					className={cn(
						"flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-colors",
						rate !== 1
							? "bg-primary/15 text-primary"
							: "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
					)}
				>
					{rate}x
				</button>
				<div className="flex items-center gap-1.5">
					<ControlButton
						icon={muted || volume === 0 ? "icon-[mdi--volume-off]" : "icon-[mdi--volume-high]"}
						title={muted ? t("audio.unmute") : t("audio.mute")}
						onClick={toggleMute}
					/>
					<Slider
						value={[muted ? 0 : volume]}
						min={0}
						max={1}
						step={0.01}
						onValueChange={handleVolume}
						className="w-20"
					/>
				</div>
			</div>
		</div>
	);
}

function ControlButton({
	icon,
	title,
	onClick,
	active,
}: {
	icon: string;
	title: string;
	onClick: () => void;
	active?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={cn(
				"flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
				active ? "bg-primary/15 text-primary" : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
			)}
		>
			<span className={cn(icon, "h-4.5 w-4.5")} />
		</button>
	);
}
