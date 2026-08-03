import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { cn } from "@shared/lib/utils";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const FERRET_VIDEO_SOURCES = {
	blink: "./new-session/ferret-blink.webm",
	crawl: "./new-session/ferret-crawl.webm",
	wave: "./new-session/ferret-wave.webm",
} as const;
const MASCOT_ACTIONS = ["blink", "wave", "crawl"] as const;
const CRAWL_DURATION_SECONDS = 10.066;
const CRAWL_START_PAUSE_SECONDS = 3;
const CENTER_POSITION = "calc(50% - 4.5rem)";
const RIGHT_POSITION = "calc(100% - 9rem)";
const MASCOT_VISIBLE_STORAGE_KEY = "vetta-new-session-mascot-visible";
const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;
const MINIMUM_ACTION_INTERVAL = HOUR_IN_MILLISECONDS;
const MAXIMUM_ACTION_INTERVAL = HOUR_IN_MILLISECONDS * 3;

type MascotAction = (typeof MASCOT_ACTIONS)[number];

interface NewSessionMascotProps {
	autoplay: boolean;
	mounted: boolean;
}

export function NewSessionMascot({ autoplay, mounted }: NewSessionMascotProps): JSX.Element {
	const { t } = useTranslation("chat");
	const reduceMotion = useReducedMotion();
	const [action, setAction] = useState<MascotAction>(() => pickRandomAction());
	const [mascotVisible, setMascotVisible] = useState(readMascotVisible);
	const [playing, setPlaying] = useState(false);

	const handleComplete = useCallback(() => {
		setAction((current) => pickRandomAction(current));
		setPlaying(false);
	}, []);
	const handlePlayOnce = useCallback(() => {
		setPlaying(true);
	}, []);

	useEffect(() => {
		if (!mascotVisible || !autoplay || reduceMotion || playing) return;

		const timer = window.setTimeout(() => {
			setPlaying(true);
		}, randomActionInterval());

		return () => window.clearTimeout(timer);
	}, [autoplay, mascotVisible, playing, reduceMotion]);

	const handleVisibilityToggle = useCallback(() => {
		setMascotVisible((current) => {
			const next = !current;
			window.localStorage.setItem(MASCOT_VISIBLE_STORAGE_KEY, String(next));
			return next;
		});
		setPlaying(false);
	}, []);

	const canPlay = mascotVisible && autoplay && !reduceMotion;
	const actionPlaying = canPlay && playing;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-6 z-30 h-20 select-none"
		>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label={t("newSession.mascot.menuTrigger")}
						className="no-drag pointer-events-auto absolute right-16 -top-5 rounded-full border border-border/40 bg-background/80 text-muted-foreground backdrop-blur-sm"
						size="icon-xs"
						variant="ghost"
					>
						<span aria-hidden className="icon-[solar--alt-arrow-down-linear] h-3 w-3" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center" className="min-w-28" side="top">
					<DropdownMenuItem onSelect={handleVisibilityToggle}>
						{t(
							mascotVisible
								? "newSession.mascot.hideMascot"
								: "newSession.mascot.showMascot",
						)}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{!mascotVisible ? null : actionPlaying ? (
				action === "crawl" ? (
					<CrawlPass onComplete={handleComplete} />
				) : (
					<video
						aria-hidden="true"
						autoPlay
						className="pointer-events-none absolute right-0 -bottom-10 h-36 w-36 object-contain object-center"
						draggable={false}
						muted
						onEnded={handleComplete}
						playsInline
						preload="auto"
						src={FERRET_VIDEO_SOURCES[action]}
					/>
				)
			) : (
				<>
					<video
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute right-0 h-36 w-36 object-contain object-center",
							action === "crawl" ? "-bottom-[30px]" : "-bottom-10",
						)}
						draggable={false}
						muted
						playsInline
						preload="auto"
						src={FERRET_VIDEO_SOURCES[action]}
					/>
					{canPlay ? (
						<Button
							aria-label={t("newSession.mascot.playOnce")}
							className={cn(
								"no-drag pointer-events-auto absolute right-0 z-10 h-20 w-36 bg-transparent p-0 hover:bg-transparent",
								action === "crawl" ? "-bottom-[10px]" : "-bottom-5",
							)}
							onClick={handlePlayOnce}
							variant="ghost"
						>
							<span className="sr-only">{t("newSession.mascot.playOnce")}</span>
						</Button>
					) : null}
				</>
			)}
		</motion.div>
	);
}

interface CrawlPassProps {
	onComplete: () => void;
}

function CrawlPass({ onComplete }: CrawlPassProps): JSX.Element {
	const [returning, setReturning] = useState(false);
	const returningRef = useRef(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const animationFrameRef = useRef<number | null>(null);
	const left = useMotionValue(RIGHT_POSITION);

	const updatePosition = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;

		const duration = Number.isFinite(video.duration) ? video.duration : CRAWL_DURATION_SECONDS;
		const moveProgress = Math.min(
			1,
			Math.max(0, (video.currentTime - CRAWL_START_PAUSE_SECONDS) / (duration - CRAWL_START_PAUSE_SECONDS)),
		);
		const rightness = returningRef.current ? moveProgress : 1 - moveProgress;
		left.set(positionForRightness(rightness));

		if (!video.paused && !video.ended) {
			animationFrameRef.current = window.requestAnimationFrame(updatePosition);
		}
	}, [left]);

	const startTracking = useCallback(() => {
		if (animationFrameRef.current !== null) {
			window.cancelAnimationFrame(animationFrameRef.current);
		}
		animationFrameRef.current = window.requestAnimationFrame(updatePosition);
	}, [updatePosition]);

	useEffect(
		() => () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
			}
		},
		[],
	);

	const handleEnded = useCallback(
		(event: SyntheticEvent<HTMLVideoElement>) => {
			left.set(returningRef.current ? RIGHT_POSITION : CENTER_POSITION);
			if (returningRef.current) {
				onComplete();
				return;
			}
			returningRef.current = true;
			setReturning(true);
			event.currentTarget.currentTime = 0;
			void event.currentTarget.play();
		},
		[left, onComplete],
	);

	return (
		<motion.video
			aria-hidden="true"
			autoPlay
			className="pointer-events-none absolute -bottom-[30px] h-36 w-36 object-contain object-center"
			draggable={false}
			muted
			onEnded={handleEnded}
			onPlaying={startTracking}
			playsInline
			preload="auto"
			ref={videoRef}
			src={FERRET_VIDEO_SOURCES.crawl}
			style={{ left, scaleX: returning ? -1 : 1 }}
		/>
	);
}

function pickRandomAction(current?: MascotAction): MascotAction {
	const candidates = current
		? MASCOT_ACTIONS.filter((candidate) => candidate !== current)
		: MASCOT_ACTIONS;
	return candidates[Math.floor(Math.random() * candidates.length)];
}

function randomActionInterval(): number {
	return MINIMUM_ACTION_INTERVAL + Math.random() * (MAXIMUM_ACTION_INTERVAL - MINIMUM_ACTION_INTERVAL);
}

function readMascotVisible(): boolean {
	return window.localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY) !== "false";
}

function positionForRightness(rightness: number): string {
	const percentage = 50 + rightness * 50;
	const widthOffsetRem = 4.5 + rightness * 4.5;
	return `calc(${percentage}% - ${widthOffsetRem}rem)`;
}
