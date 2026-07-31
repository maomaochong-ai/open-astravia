import { motion, useMotionValue, useReducedMotion } from "motion/react";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const FERRET_VIDEO_SOURCES = {
	blink: "./new-session/ferret-blink.webm",
	crawl: "./new-session/ferret-crawl.webm",
	wave: "./new-session/ferret-wave.webm",
} as const;
const MASCOT_ACTIONS = ["blink", "wave", "crawl"] as const;
const CRAWL_DURATION_SECONDS = 10.066;
const CRAWL_EDGE_PAUSE_SECONDS = 1;
const CRAWL_MOVE_DURATION_SECONDS = CRAWL_DURATION_SECONDS - CRAWL_EDGE_PAUSE_SECONDS * 2;
const CENTER_POSITION = "calc(50% - 4.5rem)";
const RIGHT_POSITION = "calc(100% - 9rem)";

type MascotAction = (typeof MASCOT_ACTIONS)[number];

interface NewSessionMascotProps {
	autoplay: boolean;
	mounted: boolean;
}

export function NewSessionMascot({ autoplay, mounted }: NewSessionMascotProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const [action, setAction] = useState<MascotAction>(() => pickRandomAction());

	const handleComplete = useCallback(() => {
		setAction((current) => pickRandomAction(current));
	}, []);

	return (
		<motion.div
			aria-hidden="true"
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-6 z-30 h-20 select-none"
		>
			{autoplay && !reduceMotion ? (
				action === "crawl" ? (
					<CrawlPass onComplete={handleComplete} />
				) : (
					<video
						autoPlay
						className="absolute right-0 bottom-0 h-20 w-36 object-cover object-center"
						draggable={false}
						muted
						onEnded={handleComplete}
						playsInline
						preload="auto"
						src={FERRET_VIDEO_SOURCES[action]}
					/>
				)
			) : null}
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

		const moveProgress = Math.min(
			1,
			Math.max(0, (video.currentTime - CRAWL_EDGE_PAUSE_SECONDS) / CRAWL_MOVE_DURATION_SECONDS),
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
			returningRef.current = !returningRef.current;
			setReturning(returningRef.current);
			event.currentTarget.currentTime = 0;
			void event.currentTarget.play();
		},
		[left, onComplete],
	);

	return (
		<motion.video
			autoPlay
			className="absolute bottom-0 h-20 w-36 object-cover object-center"
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

function positionForRightness(rightness: number): string {
	const percentage = 50 + rightness * 50;
	const widthOffsetRem = 4.5 + rightness * 4.5;
	return `calc(${percentage}% - ${widthOffsetRem}rem)`;
}
