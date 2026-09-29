// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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
			soundNotifications: "提示音",
			soundNotificationsDescription: "任务完成时播放提示音",
			soundTiming: "提示音时机",
			preview: "试听提示音",
			previewAction: "试听",
			scopes: { "background-only": "仅后台", "away-from-session": "离开会话", always: "始终" },
		},
		notificationsEnabled: true,
		soundEnabled: true,
		soundScope: "always",
		onNotificationsEnabledChange: vi.fn(),
		onSoundEnabledChange: vi.fn(),
		onSoundScopeChange: vi.fn(),
		onPreview: vi.fn(),
		...overrides,
	};
}

describe("NotificationSettingsView", () => {
	it("lets the user toggle system notifications and sound switch", async () => {
		const user = userEvent.setup();
		const input = props();
		const view = render(<NotificationSettingsView {...input} />);

		const switches = view.getAllByRole("switch");
		await user.click(switches[0] as HTMLElement);
		expect(input.onNotificationsEnabledChange).toHaveBeenCalledWith(false);

		await user.click(switches[1] as HTMLElement);
		expect(input.onSoundEnabledChange).toHaveBeenCalledWith(false);
	});

	it("previews sound and hides timing when sound is disabled", async () => {
		const user = userEvent.setup();
		const input = props();
		const view = render(<NotificationSettingsView {...input} />);

		const previewButton = view.getByRole("button", { name: "试听" });
		await user.click(previewButton);
		expect(input.onPreview).toHaveBeenCalled();

		view.rerender(<NotificationSettingsView {...input} soundEnabled={false} />);
		expect(view.queryByRole("button", { name: "试听" })).toBeNull();
		expect(view.queryByText("提示音时机")).toBeNull();
	});
});
