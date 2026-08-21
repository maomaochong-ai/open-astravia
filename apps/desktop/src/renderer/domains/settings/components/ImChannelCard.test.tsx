// @vitest-environment jsdom
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { ImChannelCard } = await import("./ImChannelCard.js");

const BASE = {
	name: "Telegram",
	subtitle: "使用 Telegram Bot API 接收消息。",
	iconClass: "icon-[mdi--telegram]",
	transportStatus: "online" as const,
	configureLabel: "配置渠道",
};

describe("ImChannelCard", () => {
	it("已配置的非活动渠道：整卡点击切换为活动渠道", async () => {
		const onActivate = vi.fn();
		const onConfigure = vi.fn();
		const view = render(
			<ImChannelCard {...BASE} configured isActive={false} onConfigure={onConfigure} onActivate={onActivate} />,
		);

		await userEvent.click(view.getByRole("button", { name: "Telegram · activateChannelTitle" }));

		expect(onActivate).toHaveBeenCalledTimes(1);
		expect(onConfigure).not.toHaveBeenCalled();
	});

	it("齿轮按钮进配置，不会顺带激活渠道", async () => {
		const onActivate = vi.fn();
		const onConfigure = vi.fn();
		const view = render(
			<ImChannelCard {...BASE} configured isActive={false} onConfigure={onConfigure} onActivate={onActivate} />,
		);

		await userEvent.click(view.getByRole("button", { name: "Telegram · 配置渠道" }));

		expect(onConfigure).toHaveBeenCalledTimes(1);
		expect(onActivate).not.toHaveBeenCalled();
	});

	it("未配置渠道：整卡点击直接进配置", async () => {
		const onActivate = vi.fn();
		const onConfigure = vi.fn();
		const view = render(
			<ImChannelCard
				{...BASE}
				configured={false}
				isActive={false}
				onConfigure={onConfigure}
				onActivate={onActivate}
			/>,
		);

		// 未配置时整卡与齿轮是同一个动作，两者可访问名相同；取 DOM 中靠前的整卡按钮。
		await userEvent.click(view.getAllByRole("button", { name: "Telegram · 配置渠道" })[0]);

		expect(onConfigure).toHaveBeenCalledTimes(1);
		expect(onActivate).not.toHaveBeenCalled();
		expect(view.getByText("channelNotAssociated")).toBeDefined();
	});

	it("活动渠道展示实时连接状态，非活动渠道只展示配置状态", () => {
		const active = render(<ImChannelCard {...BASE} configured isActive onConfigure={vi.fn()} />);
		expect(active.getByText("imbStatusOnline")).toBeDefined();
		expect(active.getByText("channelActive")).toBeDefined();
		active.unmount();

		const idle = render(
			<ImChannelCard {...BASE} configured isActive={false} onConfigure={vi.fn()} onActivate={vi.fn()} />,
		);
		expect(idle.queryByText("imbStatusOnline")).toBeNull();
		expect(idle.getByText("channelConfigured")).toBeDefined();
	});
});
