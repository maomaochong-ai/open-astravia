// @vitest-environment jsdom
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
	"messageList.tokenUsage.uncachedInput": "输入",
	"messageList.tokenUsage.output": "输出",
	"messageList.tokenUsage.cacheRead": "缓存命中",
	"messageList.tokenUsage.cacheWrite": "缓存写入",
	"messageList.tokenUsage.cacheHitRate": "缓存命中率",
	"messageList.tokenUsage.moreParameters": "更多参数",
	"messageList.tokenUsage.readCoverage": "读取观测覆盖率",
	"messageList.tokenUsage.writeCoverage": "写入观测覆盖率",
	"messageList.tokenUsage.readOnlyReporting": "未上报（只读）",
	"messageList.tokenUsage.diagnosticCoverage": "前缀诊断覆盖",
	"messageList.tokenUsage.stableSystemChars": "稳定系统提示词字符",
	"messageList.tokenUsage.volatileSystemChars": "动态系统提示词字符",
	"messageList.tokenUsage.historyMessages": "前缀历史消息",
	"messageList.tokenUsage.toolCount": "工具数量",
	"messageList.tokenUsage.prefixStatus": "稳定前缀状态",
	"messageList.tokenUsage.changedSegments": "变化部分",
	"messageList.tokenUsage.changedPromptBlocks": "变化提示词块",
	"messageList.tokenUsage.changedTools": "变化工具",
	"messageList.tokenUsage.changeKinds.added": "新增",
	"messageList.tokenUsage.changeKinds.removed": "删除",
	"messageList.tokenUsage.changeKinds.changed": "内容变化",
	"messageList.tokenUsage.changeKinds.reordered": "顺序变化",
	"messageList.tokenUsage.segmentSeparator": "、",
	"messageList.tokenUsage.prefixStatuses.initial": "首次诊断",
	"messageList.tokenUsage.prefixStatuses.extended": "连续扩展",
	"messageList.tokenUsage.prefixStatuses.changed": "前缀已改变",
	"messageList.tokenUsage.prefixStatuses.unknown": "历史版本不可比较",
	"messageList.tokenUsage.prefixSegments.stableSystem": "稳定系统提示词",
	"messageList.tokenUsage.prefixSegments.volatileSystem": "动态系统提示词",
	"messageList.tokenUsage.prefixSegments.tools": "工具定义",
	"messageList.tokenUsage.prefixSegments.messages": "历史消息",
	"messageList.tokenUsage.prefixHash": "请求前缀指纹",
	"messageList.tokenUsage.unavailable": "未上报",
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { count?: number; id?: string; change?: string }) => {
			if (key === "messageList.tokenUsage.modelCalls") return `${values?.count} 次模型调用`;
			if (key === "messageList.tokenUsage.definitionChange") return `${values?.id}（${values?.change}）`;
			return labels[key] ?? key;
		},
		i18n: { language: "zh-CN", resolvedLanguage: "zh-CN" },
	}),
}));

import { MessageTokenUsage } from "./MessageTokenUsage";

describe("MessageTokenUsage", () => {
	it("opens the usage panel on click and keeps developer diagnostics collapsed", async () => {
		const user = userEvent.setup();
		render(
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
						promptCache: promptCacheDiagnostics(),
					}),
				]}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "查看本轮 Token 用量" });
		await user.hover(trigger);
		expect(screen.queryByRole("dialog")).toBeNull();

		await user.click(trigger);
		const panel = await screen.findByRole("dialog");
		expect(within(panel).getByText("本轮 Token")).toBeTruthy();
		expect(within(panel).getByText("2 次模型调用")).toBeTruthy();
		expect(within(panel).getByText("230")).toBeTruthy();
		expect(within(panel).getByText("60%")).toBeTruthy();
		expect(within(panel).queryByText("前缀诊断覆盖")).toBeNull();
		expect(within(panel).queryByText("读取观测覆盖率")).toBeNull();
		expect(within(panel).queryByText("pc1:1234567890abcdef")).toBeNull();

		await user.click(within(panel).getByRole("button", { name: "更多参数" }));
		expect(within(panel).getByText("读取观测覆盖率")).toBeTruthy();
		expect(within(panel).getByText("100%")).toBeTruthy();
		expect(within(panel).getByText("50%")).toBeTruthy();
		expect(within(panel).getByText("前缀诊断覆盖")).toBeTruthy();
		expect(within(panel).getByText("1/2")).toBeTruthy();
		expect(within(panel).getByText("pc1:1234567890abcdef")).toBeTruthy();
		expect(within(panel).getByText("连续扩展")).toBeTruthy();
		expect(within(panel).getByText("动态系统提示词")).toBeTruthy();
		expect(within(panel).getByText("变化提示词块")).toBeTruthy();
		expect(within(panel).getByText("plugin.router（内容变化）")).toBeTruthy();
		expect(within(panel).getByText("变化工具")).toBeTruthy();
		expect(within(panel).getByText("todo_write（新增）、read（内容变化）")).toBeTruthy();
	});

	it("explains that write metrics are unavailable for read-only providers", async () => {
		const user = userEvent.setup();
		render(
			<MessageTokenUsage
				usages={[usage({ input: 20, output: 2, cacheRead: 80, cacheUsageReporting: "read-only" })]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "查看本轮 Token 用量" }));
		const panel = await screen.findByRole("dialog");
		await user.click(within(panel).getByRole("button", { name: "更多参数" }));
		expect(within(panel).getByText("未上报（只读）")).toBeTruthy();
	});

	it("abbreviates large token counts with K and M units", async () => {
		const user = userEvent.setup();
		render(
			<MessageTokenUsage
				usages={[usage({ input: 1500, output: 2_400_000, cacheRead: 12_000, cacheWrite: 999 })]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "查看本轮 Token 用量" }));
		const panel = await screen.findByRole("dialog");
		// 总计与「输出」都落在 2.4M。
		expect(within(panel).getAllByText("2.4M")).toHaveLength(2);
		expect(within(panel).getByText("1.5K")).toBeTruthy();
		expect(within(panel).getByText("12K")).toBeTruthy();
		expect(within(panel).getByText("999")).toBeTruthy();
	});

	it("shows a placeholder instead of a zero token count", async () => {
		const user = userEvent.setup();
		render(<MessageTokenUsage usages={[usage({ input: 40, output: 10 })]} />);

		await user.click(screen.getByRole("button", { name: "查看本轮 Token 用量" }));
		const panel = await screen.findByRole("dialog");
		// 缓存读取与缓存写入均为 0。
		expect(within(panel).getAllByText("--")).toHaveLength(2);
	});

	it("renders nothing when a historical message has no usage", () => {
		const { container } = render(<MessageTokenUsage usages={[]} />);
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
		promptCache: overrides.promptCache,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function promptCacheDiagnostics(): NonNullable<Usage["promptCache"]> {
	return {
		cachePrefixHash: "pc1:1234567890abcdef",
		stableSystemPromptHash: "pc1:stable",
		volatileSystemPromptHash: "pc1:volatile",
		toolsHash: "pc1:tools",
		historyPrefixHash: "pc1:history",
		requestMessagesHash: "pc1:request-messages",
		requestMessageCount: 5,
		prefixStatus: "extended",
		changedSegments: ["volatile-system"],
		changedSystemPromptBlocks: [{ id: "plugin.router", change: "changed" }],
		changedTools: [
			{ id: "todo_write", change: "added" },
			{ id: "read", change: "changed" },
		],
		stableSystemPromptLength: 120,
		volatileSystemPromptLength: 20,
		historyPrefixMessages: 4,
		toolCount: 3,
	};
}
