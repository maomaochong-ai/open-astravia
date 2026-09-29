import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notification-preferences.js";
import { decideNotificationDelivery } from "./notification-policy.js";

describe("notification delivery policy", () => {
	const preferences = {
		...DEFAULT_NOTIFICATION_PREFERENCES,
		events: {
			...DEFAULT_NOTIFICATION_PREFERENCES.events,
			completed: { systemEnabled: true, soundId: "soft-chime" as const },
		},
	};

	it.each([
		["background-only", false, true, true],
		["background-only", true, false, false],
		["away-from-session", true, false, true],
		["away-from-session", true, true, false],
		["always", true, true, true],
	] as const)("applies %s scope", (scope, focused, viewing, expected) => {
		const decision = decideNotificationDelivery(
			"completed",
			{ ...preferences, systemScope: scope, soundScope: scope },
			{
				windowFocused: focused,
				viewingTargetSession: viewing,
				systemNotificationsEnabled: true,
				systemNotificationsSupported: true,
			},
		);
		expect(decision.showSystemNotification).toBe(expected);
		expect(Boolean(decision.soundId)).toBe(expected);
	});

	it("keeps sound independent when system notifications are disabled or unsupported", () => {
		const decision = decideNotificationDelivery("completed", preferences, {
			windowFocused: false,
			viewingTargetSession: false,
			systemNotificationsEnabled: false,
			systemNotificationsSupported: false,
		});
		expect(decision).toMatchObject({ showSystemNotification: false, soundId: "soft-chime", volume: 60 });
	});

	it("plays sound by default for events", () => {
		for (const event of ["completed", "failed", "actionRequired"] as const) {
			expect(
				decideNotificationDelivery(event, DEFAULT_NOTIFICATION_PREFERENCES, {
					windowFocused: false,
					viewingTargetSession: false,
					systemNotificationsEnabled: true,
					systemNotificationsSupported: true,
				}).soundId,
			).toBe("soft-chime");
		}
	});

	it("mutes sound when soundEnabled is false", () => {
		for (const event of ["completed", "failed", "actionRequired"] as const) {
			expect(
				decideNotificationDelivery(
					event,
					{ ...DEFAULT_NOTIFICATION_PREFERENCES, soundEnabled: false },
					{
						windowFocused: false,
						viewingTargetSession: false,
						systemNotificationsEnabled: true,
						systemNotificationsSupported: true,
					},
				).soundId,
			).toBeNull();
		}
	});
});
