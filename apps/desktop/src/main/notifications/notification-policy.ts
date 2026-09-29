import type {
	BuiltinNotificationSoundId,
	DesktopNotificationPreferences,
	NotificationDeliveryScope,
	NotificationEventType,
} from "../../shared/notification-preferences.js";

export interface NotificationDeliveryContext {
	windowFocused: boolean;
	viewingTargetSession: boolean;
	systemNotificationsEnabled: boolean;
	systemNotificationsSupported: boolean;
}

export interface NotificationDeliveryDecision {
	showSystemNotification: boolean;
	soundId: BuiltinNotificationSoundId | null;
	volume: number;
}

function scopeAllows(scope: NotificationDeliveryScope, context: NotificationDeliveryContext): boolean {
	if (scope === "always") return true;
	if (scope === "background-only") return !context.windowFocused;
	return !context.windowFocused || !context.viewingTargetSession;
}

export function decideNotificationDelivery(
	event: NotificationEventType,
	preferences: DesktopNotificationPreferences,
	context: NotificationDeliveryContext,
): NotificationDeliveryDecision {
	const eventPreference = preferences.events?.[event];
	const soundAllowed = preferences.soundEnabled && scopeAllows(preferences.soundScope, context);
	return {
		showSystemNotification:
			context.systemNotificationsEnabled &&
			context.systemNotificationsSupported &&
			(eventPreference ? eventPreference.systemEnabled : true) &&
			scopeAllows(preferences.systemScope, context),
		soundId: soundAllowed ? (eventPreference?.soundId ?? "soft-chime") : null,
		volume: preferences.soundVolume,
	};
}
