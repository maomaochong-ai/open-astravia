export const BUILTIN_NOTIFICATION_SOUND_IDS = ["soft-chime", "single-bell", "wood-tap", "digital-pulse"] as const;
export const DEFAULT_NOTIFICATION_SOUND_ID = "soft-chime" as const;

export type BuiltinNotificationSoundId = (typeof BUILTIN_NOTIFICATION_SOUND_IDS)[number];
export type NotificationDeliveryScope = "background-only" | "away-from-session" | "always";
export type NotificationEventType = "completed" | "failed" | "actionRequired";

export interface NotificationEventPreference {
	systemEnabled: boolean;
	soundId: BuiltinNotificationSoundId | null;
}

export interface DesktopNotificationPreferences {
	soundEnabled: boolean;
	systemScope: NotificationDeliveryScope;
	soundScope: NotificationDeliveryScope;
	soundVolume: number;
	events: Record<NotificationEventType, NotificationEventPreference>;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: DesktopNotificationPreferences = {
	soundEnabled: true,
	systemScope: "away-from-session",
	soundScope: "always",
	soundVolume: 60,
	events: {
		completed: { systemEnabled: true, soundId: DEFAULT_NOTIFICATION_SOUND_ID },
		failed: { systemEnabled: true, soundId: DEFAULT_NOTIFICATION_SOUND_ID },
		actionRequired: { systemEnabled: true, soundId: DEFAULT_NOTIFICATION_SOUND_ID },
	},
};

export function isBuiltinNotificationSoundId(value: unknown): value is BuiltinNotificationSoundId {
	return typeof value === "string" && BUILTIN_NOTIFICATION_SOUND_IDS.some((sound) => sound === value);
}

function normalizeScope(
	value: unknown,
	defaultScope: NotificationDeliveryScope = "away-from-session",
): NotificationDeliveryScope {
	return value === "background-only" || value === "always" || value === "away-from-session" ? value : defaultScope;
}

function normalizeEventPreference(value: unknown): NotificationEventPreference {
	const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	return {
		systemEnabled: input.systemEnabled !== false,
		soundId: isBuiltinNotificationSoundId(input.soundId) ? input.soundId : DEFAULT_NOTIFICATION_SOUND_ID,
	};
}

export function normalizeNotificationPreferences(value: unknown): DesktopNotificationPreferences {
	const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const events =
		typeof input.events === "object" && input.events !== null ? (input.events as Record<string, unknown>) : {};
	const volume =
		typeof input.soundVolume === "number" && Number.isFinite(input.soundVolume)
			? Math.round(input.soundVolume)
			: DEFAULT_NOTIFICATION_PREFERENCES.soundVolume;
	const soundEnabled = typeof input.soundEnabled === "boolean" ? input.soundEnabled : true;
	return {
		soundEnabled,
		systemScope: normalizeScope(input.systemScope, "away-from-session"),
		soundScope: normalizeScope(input.soundScope, "always"),
		soundVolume: Math.max(0, Math.min(100, volume)),
		events: {
			completed: normalizeEventPreference(events.completed),
			failed: normalizeEventPreference(events.failed),
			actionRequired: normalizeEventPreference(events.actionRequired),
		},
	};
}
