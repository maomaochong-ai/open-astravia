import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notification-preferences.js";

const mocks = vi.hoisted(() => {
	class Notification {
		static instances: Notification[] = [];
		static isSupported = vi.fn(() => true);
		readonly options: Record<string, unknown>;
		on = vi.fn();
		show = vi.fn();
		close = vi.fn();
		constructor(options: Record<string, unknown>) {
			this.options = options;
			Notification.instances.push(this);
		}
	}
	return {
		Notification,
		readConfigSync: vi.fn(),
		isFocused: vi.fn(() => false),
		send: vi.fn(),
	};
});

vi.mock("electron", () => ({ Notification: mocks.Notification }));
vi.mock("../ipc/fs.js", () => ({ readConfigSync: mocks.readConfigSync }));
vi.mock("../i18n/index.js", () => ({ mainT: (key: string) => key }));
vi.mock("../window-manager.js", () => ({
	getMainWindow: () => ({ isFocused: mocks.isFocused }),
	iconPath: { win32: "icon", darwin: "icon", linux: "icon" },
	showMainWindow: vi.fn(),
}));

const service = await import("./notification-service.js");

beforeEach(() => {
	mocks.Notification.instances.length = 0;
	mocks.send.mockReset();
	mocks.isFocused.mockReturnValue(false);
	mocks.readConfigSync.mockReturnValue({
		notificationsEnabled: true,
		notificationPreferences: {
			...DEFAULT_NOTIFICATION_PREFERENCES,
			events: {
				...DEFAULT_NOTIFICATION_PREFERENCES.events,
				completed: { systemEnabled: true, soundId: "soft-chime" },
			},
		},
	});
	service.setNotificationWebContents({ isDestroyed: () => false, send: mocks.send } as never);
	service.setForegroundSessionPath(null);
});

describe("agent notification delivery", () => {
	it("uses a silent system banner and independently dispatches the configured sound", async () => {
		await service.notify({
			type: "agent-turn-complete",
			sessionPath: "missing-session.jsonl",
			cwd: "C:/project",
			outcome: "completed",
		});

		expect(mocks.send).toHaveBeenCalledWith(service.NOTIFICATION_SOUND_CHANNEL, {
			soundId: "soft-chime",
			volume: 60,
		});
		expect(mocks.Notification.instances).toHaveLength(1);
		expect(mocks.Notification.instances[0]?.options.silent).toBe(true);
		expect(mocks.Notification.instances[0]?.show).toHaveBeenCalled();
	});

	it("can play a sound when the system banner is globally disabled", async () => {
		mocks.readConfigSync.mockReturnValue({
			notificationsEnabled: false,
			notificationPreferences: {
				...DEFAULT_NOTIFICATION_PREFERENCES,
				events: {
					...DEFAULT_NOTIFICATION_PREFERENCES.events,
					completed: { systemEnabled: true, soundId: "single-bell" },
				},
			},
		});
		await service.notify({
			type: "agent-turn-complete",
			sessionPath: "missing-session.jsonl",
			cwd: "C:/project",
			outcome: "completed",
		});
		expect(mocks.send).toHaveBeenCalled();
		expect(mocks.Notification.instances).toHaveLength(0);
	});
});
