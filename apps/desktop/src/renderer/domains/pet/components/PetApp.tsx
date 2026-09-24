import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PET_ACTIONS, type PetActionId } from "../../../../shared/pet-actions";
import {
	DEFAULT_PET_VIDEO_SIZE,
	PET_SIZE_MAX,
	normalizePetVideoSize,
	normalizePetVideoSizeForWindow,
} from "../../../../shared/pet-config";
import type { PetActivityState, PetBridge } from "../../../../shared/pet-ipc";
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
import { usePetWidgetLayout } from "../hooks/usePetWidgetLayout";
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
	const [activityState, setActivityState] = useState<PetActivityState>("idle");
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
	const shellRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLDivElement>(null);
	const autoModeRef = useRef(autoMode);
	const appActionIdRef = useRef<PetActionId | undefined>(undefined);
	const appActivityStateRef = useRef<PetActivityState>("idle");
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
	const bubblePlacement = bubble && contentOffset.y < 0 ? "below" : "above";

	const clearUserOverrideTimer = () => {
		if (userOverrideTimerRef.current == null) return;
		window.clearTimeout(userOverrideTimerRef.current);
		userOverrideTimerRef.current = undefined;
	};
	const isUserOverrideActive = () => Date.now() < userOverrideUntilRef.current;
	const applyAutomaticAction = () => {
		if (appActionIdRef.current && appActivityStateRef.current !== "idle") {
			setActivityState(appActivityStateRef.current);
			setActionId(appActionIdRef.current);
			return;
		}
		setActivityState("idle");
		if (!autoModeRef.current) {
			if (appActionIdRef.current) setActionId(appActionIdRef.current);
			return;
		}
		setActionId((current) => pickNextAction(videos, current));
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

	usePetWidgetLayout({
		shellRef,
		videoRef,
		contentOffset,
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
		if (activityState !== "idle" || !autoMode || !actionId || playbackPaused) return;
		const timer = window.setTimeout(() => {
			if (isUserOverrideActive()) return;
			setActionId((current) => pickNextAction(videos, current));
		}, getActionDuration(actionId));
		return () => window.clearTimeout(timer);
	}, [actionId, activityState, autoMode, playbackPaused, videos]);

	useEffect(() => {
		setFailedVideoSrc(undefined);
		setVideoNaturalSize(undefined);
	}, [actionId]);

	useEffect(() => {
		return window.vettaPet?.onCommand((command) => {
			if (command.type === "set-state") {
				appActivityStateRef.current = command.state;
				appActionIdRef.current = command.actionId;
				if (command.state === "waiting_input" || command.state === "error") {
					clearUserOverrideTimer();
					userOverrideUntilRef.current = 0;
					clearPresentationThrottle();
				}
				if (!isUserOverrideActive()) {
					setActivityState(command.state);
					setActionId(command.actionId);
				}
				return;
			}
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
	}, [clearPresentationThrottle, hideBubble, queueAppAction, showBubble, videos]);

	const speechBubble = (
		<PetSpeechBubble
			decorUrl={bubbleStyle.decorUrl}
			message={bubble}
			styleId={bubbleStyle.styleId}
		/>
	);

	return (
		<div
			ref={shellRef}
			className="inline-flex flex-col items-center overflow-hidden bg-transparent"
			data-state={activityState}
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
			{bubblePlacement === "above" ? speechBubble : null}
			<div
				className="relative flex cursor-move items-center justify-center"
				data-testid="pet-video-slot"
				style={{
					width: `${videoSize.width}px`,
					height: `${videoSize.height}px`,
					// 气泡贴边放不下时主进程让精灵在窗口内平移，精灵的屏幕位置由此保持不变。
					...(contentOffset.x !== 0 ? { transform: `translateX(${contentOffset.x}px)` } : {}),
				}}
			>
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
			{bubblePlacement === "below" ? speechBubble : null}
		</div>
	);
}
