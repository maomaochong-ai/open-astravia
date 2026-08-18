import type { PetActionId } from "./pet-actions.js";
import type { PetBubbleStyleId } from "./pet-bubbles.js";

export const PET_COMMAND_CHANNEL = "vetta:pet:command";
export const PET_CONFIG_CHANGED_CHANNEL = "vetta:pet:config-changed";
export const PET_RESIZE_BY_WHEEL_CHANNEL = "vetta:pet:resize-by-wheel";
export const PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL = "vetta:pet:resize-video-by-wheel";
export const PET_BEGIN_WINDOW_MOVE_CHANNEL = "vetta:pet:begin-window-move";
export const PET_MOVE_WINDOW_BY_CHANNEL = "vetta:pet:move-window-by";
export const PET_END_WINDOW_MOVE_CHANNEL = "vetta:pet:end-window-move";
export const PET_BEGIN_WINDOW_RESIZE_CHANNEL = "vetta:pet:begin-window-resize";
export const PET_SET_WINDOW_SIZE_CHANNEL = "vetta:pet:set-window-size";
export const PET_SET_CONTENT_SIZE_CHANNEL = "vetta:pet:set-content-size";
export const PET_END_WINDOW_RESIZE_CHANNEL = "vetta:pet:end-window-resize";
export const PET_SET_VIDEO_BASE_SIZE_CHANNEL = "vetta:pet:set-video-base-size";
export const PET_SET_MOUSE_PASSTHROUGH_CHANNEL = "vetta:pet:set-mouse-passthrough";
export const PET_SET_VIDEO_HITBOX_CHANNEL = "vetta:pet:set-video-hitbox";

export type PetResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PetCommandSource = "app" | "user" | "config";
export type PetBubblePriority = "normal" | "high";
export type PetBubbleKind = "status" | "tool" | "success" | "warning" | "error";

export interface PetBubbleNotice {
	readonly kind?: PetBubbleKind;
	/** i18n key resolved at the main-process command boundary. */
	readonly messageKey?: string;
	readonly params?: Readonly<Record<string, string | number>>;
	/** Dynamic, sanitized content takes precedence over the i18n fallback. */
	readonly body?: string;
	/** Legacy/custom text fallback for callers that do not use i18n. */
	readonly text?: string;
	/** Keep the running-session notice visible until a terminal notice replaces it. */
	readonly persistent?: boolean;
	readonly ttlMs?: number;
	readonly priority?: PetBubblePriority;
	readonly dedupeKey?: string;
	readonly sessionId?: string;
}

export type PetVideoHitbox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type PetContentBounds = {
	bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	anchor: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
};

export type PetCommand =
	| {
			type: "set-action";
			actionId: PetActionId;
			source?: PetCommandSource;
			holdMs?: number;
	  }
	| {
			type: "random-action";
			source?: PetCommandSource;
			holdMs?: number;
	  }
	| {
			type: "set-auto-mode";
			enabled: boolean;
	  }
	| {
			type: "set-debug-frame";
			enabled: boolean;
	  }
	| {
			type: "set-video-scale";
			scale: number;
	  }
	| {
			type: "set-video-base-size";
			actionId: PetActionId;
			baseSize: number;
	  }
	| {
			type: "set-bubble-style";
			styleId: PetBubbleStyleId;
			decorUrl?: string;
	  }
	| {
			type: "set-content-offset";
			x: number;
			y: number;
	  }
	| {
			type: "show-bubble";
			text?: string;
			notice?: PetBubbleNotice;
			source?: PetCommandSource;
			ttlMs?: number;
			priority?: PetBubblePriority;
	  }
	| {
			type: "hide-bubble";
			source?: PetCommandSource;
	  }
	| {
			// 系统锁屏或休眠时暂停桌宠视频解码，解锁或唤醒后恢复。
			type: "set-playback";
			playing: boolean;
	  };

export type PetCommandListener = (command: PetCommand) => void;

export type PetBridge = {
	onCommand(listener: PetCommandListener): () => void;
	resizeByWheel(deltaY: number): Promise<void>;
	resizeVideoByWheel(actionId: PetActionId, deltaY: number): Promise<void>;
	beginWindowMove(): Promise<void>;
	moveWindow(): Promise<void>;
	endWindowMove(): Promise<void>;
	beginWindowResize(corner: PetResizeCorner): Promise<void>;
	setWindowSize(size: number, corner?: PetResizeCorner): Promise<void>;
	setContentSize(content: number | PetContentBounds): Promise<void>;
	endWindowResize(size: number): Promise<void>;
	setVideoBaseSize(actionId: PetActionId, baseSize: number): Promise<void>;
	setMousePassthrough(enabled: boolean): Promise<void>;
	setVideoHitbox(hitbox: PetVideoHitbox | undefined): Promise<void>;
};
