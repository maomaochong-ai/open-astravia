import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PET_ACTIONS, type PetActionId } from "../../../../shared/pet-actions";
import {
	DEFAULT_PET_VIDEO_SIZE,
	PET_SIZE_MAX,
	normalizePetVideoSize,
	normalizePetVideoSizeForWindow,
} from "../../../../shared/pet-config";
import type { PetBridge } from "../../../../shared/pet-ipc";
import { PetDebugOverlay } from "./PetDebugOverlay";
import { PetSpeechBubble } from "./PetSpeechBubble";
import { PetVideoSurface } from "./PetVideoSurface";
import { getActionDuration, pickNextAction } from "../services/pet-action-picker";
import {
	getInitialAction,
	getInitialAutoMode,
	getInitialBubbleStyle,
	getInitialContentOffset,
	getInitialDebugFrame,
	getInitialVideoBaseSizeByAction,
	getInitialVideoScale,
	getVideoMap,
} from "../services/pet-url-options";
import { getVideoDisplaySize } from "../services/pet-video-size";
import { usePetBubble } from "../hooks/usePetBubble";
import { usePetHitbox } from "../hooks/usePetHitbox";
import {
	PET_APP_PRESENTATION_MIN_HOLD_MS,
	type PetAppActionUpdate,
	usePetPresentationThrottle,
} from "../hooks/usePetPresentationThrottle";
import { getShowPetBubbleInput } from "../services/pet-bubble-state";
import { usePetWindowInteractions } from "../hooks/usePetWindowInteractions";
import { useWindowSize } from "../hooks/useWindowSize";

const USER_ACTION_HOLD_MS = 10_000;

declare global {
	interface Window {
		vettaPet?: PetBridge;
	}
}

export function PetApp(): JSX.Element {
	const videos = useMemo(() => getVideoMap(), []);
	const [actionId, setActionId] = useState<PetActionId | undefined>(() => getInitialAction(videos));
	const [bubbleStyle, setBubbleStyle] = useState(getInitialBubbleStyle);
	const [autoMode, setAutoMode] = useState(getInitialAutoMode);
	const [debugFrame, setDebugFrame] = useState(getInitialDebugFrame);
	const [videoScale, setVideoScale] = useState(getInitialVideoScale);
	const [videoBaseSizeByAction, setVideoBaseSizeByAction] = useState(getInitialVideoBaseSizeByAction);
	const [contentOffset, setContentOffset] = useState(getInitialContentOffset);
	const [failedVideoSrc, setFailedVideoSrc] = useState<string | undefined>();
	const [playbackPaused, setPlaybackPaused] = useState(false);
	const [windowSize] = useWindowSize();
	const [videoNaturalSize, setVideoNaturalSize] = useState<{ width: number; height: number } | undefined>();
	const videoRef = useRef<HTMLDivElement>(null);
	const autoModeRef = useRef(autoMode);
	const appActionIdRef = useRef<PetActionId | undefined>(undefined);
	const userOverrideUntilRef = useRef(0);
	const userOverrideTimerRef = useRef<number | undefined>(undefined);
	const { bubble, hideBubble, showBubble } = usePetBubble();

	const action = PET_ACTIONS.find((item) => item.id === actionId);
	const videoSrc = actionId ? videos[actionId] : undefined;
	const shouldShowVideo = videoSrc != null && videoSrc !== failedVideoSrc;
	const selectedVideoBaseSize = actionId ? videoBaseSizeByAction[actionId] : DEFAULT_PET_VIDEO_SIZE;
	const selectedVideoSize = normalizePetVideoSize(selectedVideoBaseSize * videoScale);
	const targetVideoSize = selectedVideoSize;
	const effectiveVideoSize = normalizePetVideoSizeForWindow(targetVideoSize, PET_SIZE_MAX);
	const videoSize = getVideoDisplaySize(videoNaturalSize, effectiveVideoSize);
	const bubbleAnchorSize = normalizePetVideoSizeForWindow(
		PET_ACTIONS.reduce(
			(total, item) => total + normalizePetVideoSize((videoBaseSizeByAction[item.id] ?? DEFAULT_PET_VIDEO_SIZE) * videoScale),
			0,
		) / PET_ACTIONS.length,
		PET_SIZE_MAX,
	);
	const bubblePlacement = bubble && contentOffset.y < 0 ? "below" : "above";
	const bubbleMaxWidth = Math.min(360, Math.max(0, windowSize.width - 24));
	const bubbleAnchorX = windowSize.width / 2 + contentOffset.x;
	const bubbleMinCenterX = bubbleMaxWidth / 2 + 12;
	const bubbleMaxCenterX = windowSize.width - bubbleMaxWidth / 2 - 12;
	const bubbleHorizontalOffset =
		bubbleMinCenterX > bubbleMaxCenterX
			? 0
			: Math.min(Math.max(bubbleAnchorX, bubbleMinCenterX), bubbleMaxCenterX) - bubbleAnchorX;

	const clearUserOverrideTimer = () => {
		if (userOverrideTimerRef.current == null) return;
		window.clearTimeout(userOverrideTimerRef.current);
		userOverrideTimerRef.current = undefined;
	};
	const isUserOverrideActive = () => Date.now() < userOverrideUntilRef.current;
	const applyAutomaticAction = () => {
		if (!autoModeRef.current) return;
		setActionId((current) => appActionIdRef.current ?? pickNextAction(videos, current));
	};
	const canApplyAppAction = useCallback(() => autoModeRef.current && !isUserOverrideActive(), []);
	const applyAppAction = useCallback(
		(update: PetAppActionUpdate) => {
			if (update.type === "set") {
				setActionId(update.actionId);
				return;
			}
			setActionId((current) => pickNextAction(videos, current));
		},
		[videos],
	);
	const handleAppActionQueued = useCallback((update: PetAppActionUpdate) => {
		if (update.type === "set") {
			appActionIdRef.current = update.actionId;
		}
	}, []);
	const { clearPresentationThrottle, queueAppAction } = usePetPresentationThrottle({
		minHoldMs: PET_APP_PRESENTATION_MIN_HOLD_MS,
		canApplyAction: canApplyAppAction,
		applyAction: applyAppAction,
		onActionQueued: handleAppActionQueued,
	});
	const scheduleUserActionRelease = (holdMs: number | undefined) => {
		clearUserOverrideTimer();
		const duration = typeof holdMs === "number" && Number.isFinite(holdMs) && holdMs > 0 ? holdMs : USER_ACTION_HOLD_MS;
		userOverrideUntilRef.current = Date.now() + duration;
		userOverrideTimerRef.current = window.setTimeout(() => {
			userOverrideTimerRef.current = undefined;
			userOverrideUntilRef.current = 0;
			applyAutomaticAction();
		}, duration);
	};

	const { handlePointerDown, handlePointerLeave, handlePointerMove, handleWheel } = usePetWindowInteractions({
		actionId,
		videoRef,
	});

	usePetHitbox({
		shouldShowVideo,
		videoRef,
	});

	useEffect(() => {
		autoModeRef.current = autoMode;
	}, [autoMode]);

	useEffect(() => {
		return () => {
			clearUserOverrideTimer();
			clearPresentationThrottle();
		};
	}, [clearPresentationThrottle]);

	useEffect(() => {
		if (!autoMode || !actionId || playbackPaused) return;
		const timer = window.setTimeout(() => {
			if (isUserOverrideActive()) return;
			if (appActionIdRef.current === actionId) {
				appActionIdRef.current = undefined;
			}
			applyAutomaticAction();
		}, getActionDuration(actionId));
		return () => window.clearTimeout(timer);
	}, [actionId, autoMode, playbackPaused, videos]);

	useEffect(() => {
		setFailedVideoSrc(undefined);
		setVideoNaturalSize(undefined);
	}, [actionId]);

	useEffect(() => {
		return window.vettaPet?.onCommand((command) => {
			if (command.type === "show-bubble") {
				const input = getShowPetBubbleInput(command);
				if (input) showBubble(input);
				return;
			}
			if (command.type === "hide-bubble") {
				hideBubble(command.source ?? "app");
				return;
			}
			if (command.type === "set-debug-frame") {
				setDebugFrame(command.enabled);
				return;
			}
			if (command.type === "set-video-scale") {
				setVideoScale(command.scale);
				return;
			}
			if (command.type === "set-video-base-size") {
				setVideoBaseSizeByAction((current) => ({
					...current,
					[command.actionId]: command.baseSize,
				}));
				return;
			}
			if (command.type === "set-bubble-style") {
				setBubbleStyle({
					styleId: command.styleId,
					...(command.decorUrl === undefined ? {} : { decorUrl: command.decorUrl }),
				});
				return;
			}
			if (command.type === "set-content-offset") {
				setContentOffset({ x: command.x, y: command.y });
				return;
			}
			if (command.type === "set-playback") {
				setPlaybackPaused(!command.playing);
				return;
			}
			if (command.type === "set-auto-mode") {
				const wasEnabled = autoModeRef.current;
				setAutoMode(command.enabled);
				autoModeRef.current = command.enabled;
				if (command.enabled && !wasEnabled && !isUserOverrideActive()) {
					applyAutomaticAction();
				}
				return;
			}
			if (command.type === "set-action") {
				const source = command.source ?? "user";
				if (source === "app") {
					queueAppAction({ type: "set", actionId: command.actionId });
					return;
				}
				if (source === "config") {
					if (!autoModeRef.current) {
						setActionId(command.actionId);
					}
					return;
				}
				setActionId(command.actionId);
				scheduleUserActionRelease(command.holdMs);
				return;
			}
			if (command.source === "app") {
				queueAppAction({ type: "random" });
				return;
			}
			setActionId((current) => pickNextAction(videos, current));
			scheduleUserActionRelease(command.holdMs);
		});
	}, [hideBubble, queueAppAction, showBubble, videos]);

	return (
		<div
			className="fixed inset-0 flex items-center justify-center overflow-hidden bg-transparent"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerLeave={handlePointerLeave}
			onWheel={handleWheel}
		>
			<PetDebugOverlay
				debugFrame={debugFrame}
				videoSize={videoSize}
				windowSize={windowSize}
			/>
			<div
				className="relative flex cursor-move items-center justify-center"
				style={{
					width: `${videoSize.width}px`,
					height: `${videoSize.height}px`,
					transform:
						contentOffset.x === 0 && contentOffset.y === 0
							? undefined
							: `translate(${contentOffset.x}px, ${contentOffset.y}px)`,
				}}
			>
				<PetSpeechBubble
					anchorSize={bubbleAnchorSize}
					decorUrl={bubbleStyle.decorUrl}
					horizontalOffset={bubbleHorizontalOffset}
					message={bubble}
					placement={bubblePlacement}
					styleId={bubbleStyle.styleId}
				/>
				<PetVideoSurface
					actionDescription={action?.description}
					debugFrame={debugFrame}
					paused={playbackPaused}
					shouldShowVideo={shouldShowVideo}
					videoRef={videoRef}
					videoSize={videoSize}
					videoSrc={videoSrc}
					onError={() => setFailedVideoSrc(videoSrc)}
					onLoadedMetadata={(size) => setVideoNaturalSize(size)}
				/>
			</div>
		</div>
	);
}
