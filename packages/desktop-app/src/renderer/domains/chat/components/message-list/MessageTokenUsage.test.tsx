// @vitest-environment jsdom
import { TooltipProvider } from "@shared/components/ui/tooltip";
import type { Usage } from "@vetta/ai";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

class TestResizeObserver implements ResizeObserver {
	disconnect(): void {}
	observe(): void {}
	unobserve(): void {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

const labels: Record<string, string> = {
	"messageList.tokenUsage.trigger": "查看本轮 Token 用量",
	"messageList.tokenUsage.title": "本轮 Token",
	"messageList.tokenUsage.total": "总计",
	"messageList.tokenUsage.prompt": "Prompt Token",
	"messageList.tokenUsage.uncachedInput": "未缓存输入",
	"messageList.tokenUsage.output": "输出",
	"messageList.tokenUsage.cacheRead": "缓存读取",
	"messageList.tokenUsage.cacheWrite": "缓存写入",
	"messageList.tokenUsage.cacheHitRate": "缓存命中率",
	"messageList.tokenUsage.readCoverage": "读取观测覆盖率",
	"messageList.tokenUsage.writeCoverage": "写入观测覆盖率",
	"messageList.tokenUsage.unavailable": "未上报",
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { count?: number }) =>
			key === "messageList.tokenUsage.modelCalls" ? `${values?.count} 次模型调用` : (labels[key] ?? key),
		i18n: { language: "zh-CN", resolvedLanguage: "zh-CN" },
	}),
}));

import { MessageTokenUsage } from "./MessageTokenUsage";

describe("MessageTokenUsage", () => {
	it("shows aggregated turn token and cache details on hover", async () => {
		const user = userEvent.setup();
		render(
			<TooltipProvider>
				<MessageTokenUsage
					usages={[
						usage({
							input: 20,
							output: 10,
							cacheRead: 70,
							cacheWrite: 10,
							cacheUsageReporting: "read-write",
						}),
						usage({
							input: 50,
							output: 20,
							cacheRead: 50,
							cacheUsageReporting: "read-only",
						}),
					]}
				/>
			</TooltipProvider>,
		);

		await user.hover(screen.getByRole("button", { name: "查看本轮 Token 用量" }));
		const panel = await screen.findByRole("tooltip");
		expect(within(panel).getByText("本轮 Token")).toBeTruthy();
		expect(within(panel).getByText("2 次模型调用")).toBeTruthy();
		expect(within(panel).getByText("230")).toBeTruthy();
		expect(within(panel).getByText("120")).toBeTruthy();
		expect(within(panel).getByText("60%")).toBeTruthy();
		expect(within(panel).getByText("100%")).toBeTruthy();
		expect(within(panel).getByText("50%")).toBeTruthy();
	});

	it("renders nothing when a historical message has no usage", () => {
		const { container } = render(
			<TooltipProvider>
				<MessageTokenUsage usages={[]} />
			</TooltipProvider>,
		);
		expect(container.childElementCount).toBe(0);
	});
});

function usage(overrides: Partial<Usage>): Usage {
	const input = overrides.input ?? 0;
	const output = overrides.output ?? 0;
	const cacheRead = overrides.cacheRead ?? 0;
	const cacheWrite = overrides.cacheWrite ?? 0;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cacheUsageReporting: overrides.cacheUsageReporting,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
