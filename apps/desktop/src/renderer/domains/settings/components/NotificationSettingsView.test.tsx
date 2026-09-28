// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	NotificationSettingsView,
	type NotificationSettingsViewProps,
} from "@vetta-org/theme-ui/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function props(overrides: Partial<NotificationSettingsViewProps> = {}): NotificationSettingsViewProps {
	return {
		section: { id: "notifications" },
		sectionTitle: "通知",
		labels: {
			systemNotifications: "系统通知",
			systemNotificationsDescription: "说明",
			systemTiming: "系统通知时机",
			soundTiming: "提示音时机",
			soundVolume: "提示音音量",
			events: "事件",
			eventCompleted: "完成",
			eventFailed: "失败",
			eventActionRequired: "等待处理",
			systemBanner: "系统横幅",
			preview: "试听",
			noSound: "无提示音",
			scopes: { "background-only": "仅后台", "away-from-session": "离开会话", always: "始终" },
			sounds: {
				"soft-chime": "柔和和弦",
				"single-bell": "单音铃声",
				"wood-tap": "木质轻敲",
				"digital-pulse": "数字脉冲",
			},
		},
		notificationsEnabled: true,
		value: {
			systemScope: "away-from-session",
			soundScope: "away-from-session",
			soundVolume: 60,
			events: {
				completed: { systemEnabled: true, soundId: null },
				failed: { systemEnabled: true, soundId: null },
				actionRequired: { systemEnabled: true, soundId: null },
			},
		},
		onNotificationsEnabledChange: vi.fn(),
		onSystemScopeChange: vi.fn(),
		onSoundScopeChange: vi.fn(),
		onSoundVolumeChange: vi.fn(),
		onEventSystemEnabledChange: vi.fn(),
		onEventSoundChange: vi.fn(),
		onPreview: vi.fn(),
		...overrides,
	};
}

describe("NotificationSettingsView", () => {
	it("lets the user change the master switch, volume, and an event sound", async () => {
		const user = userEvent.setup();
		const input = props();
		const view = render(<NotificationSettingsView {...input} />);

		await user.click(view.getAllByRole("switch")[0] as HTMLElement);
		expect(input.onNotificationsEnabledChange).toHaveBeenCalledWith(false);

		fireEvent.change(view.getByRole("slider", { name: "提示音音量" }), { target: { value: "35" } });
		expect(input.onSoundVolumeChange).toHaveBeenCalledWith(35);

		const failedRow = view.getByText("失败").parentElement?.parentElement;
		expect(failedRow).toBeTruthy();
		await user.click(within(failedRow as HTMLElement).getByRole("button", { name: "无提示音" }));
		await user.click(view.getByRole("button", { name: "单音铃声" }));
		expect(input.onEventSoundChange).toHaveBeenCalledWith("failed", "single-bell");
	});

	it("previews the configured sound without changing settings", async () => {
		const user = userEvent.setup();
		const defaults = props().value;
		const input = props({
			value: {
				...defaults,
				events: {
					...defaults.events,
					completed: { systemEnabled: true, soundId: "soft-chime" },
				},
			},
		});
		const view = render(<NotificationSettingsView {...input} />);
		await user.click(view.getByText("完成").parentElement?.parentElement?.querySelector("button:last-child") as HTMLElement);
		expect(input.onPreview).toHaveBeenCalledWith("soft-chime");
		expect(input.onEventSoundChange).not.toHaveBeenCalled();
	});
});
