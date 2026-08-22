// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messageList.progressGroup.thinkingActivity") return `思考：${values?.text}`;
			if (key === "messageList.progressGroup.fallbackTitle") return "正在处理";
			if (key === "messageList.progressGroup.genericRunning") return "正在处理…";
			if (key === "messageList.progressGroup.genericDone") return `完成了 ${values?.count} 步操作`;
			if (key === "messageList.progressGroup.thinking") return "正在思考";
			return key;
		},
	}),
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	ProgressGroupView: ({ children, done, title }: { children: ReactNode; done: boolean; title: string }) => (
		<div>
			<span data-testid="group-title">{title}</span>
			<span data-testid="group-status">{done ? "done" : "running"}</span>
			{children}
		</div>
	),
	ProgressGroupRow: ({ text }: { text: string }) => <span>{text}</span>,
	SegmentShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../blocks/ErrorBlock", () => ({ ErrorBlockView: () => null }));
vi.mock("../blocks/TextBlock", () => ({ TextBlockView: () => null }));
vi.mock("../blocks/ThinkingBlock", () => ({
	ThinkingBlockView: ({ title }: { title?: string }) => <span data-testid="thinking-title">{title}</span>,
}));
vi.mock("../blocks/ToolCallBlock", () => ({ ToolCallBlockView: () => null }));
vi.mock("../blocks/tool-views/shared/parse-tool", () => ({
	toolLabel: (block: { toolName: string }) => ({ name: `工具 ${block.toolName}`, detail: "" }),
}));

import type { ThinkingBlock, ToolCallBlock } from "@shared/store/atoms";
import type { ProgressGroupSegment } from "./progressGroupModel";
import { WorkSegmentRenderer } from "./WorkSegmentRenderer";

function tool(
	toolName: string,
	overrides: Partial<ToolCallBlock> = {},
): ToolCallBlock {
	return {
		type: "tool_call",
		toolCallId: `tool-${toolName}`,
		toolName,
		args: {},
		status: "pending",
		...overrides,
	};
}

function thinking(text: string): ThinkingBlock {
	return { type: "thinking", id: "thinking-1", text };
}

function stage(blocks: ProgressGroupSegment["blocks"], overrides: Partial<ProgressGroupSegment> = {}): ProgressGroupSegment {
	return {
		type: "progress_group",
		id: "stage-1",
		stageId: "stage-1",
		label: "核对项目",
		closed: false,
		blocks,
		...overrides,
	};
}

function renderSegment(segment: ProgressGroupSegment, isLiveActivity = true): void {
	render(
		<Provider store={createStore()}>
			<WorkSegmentRenderer segment={segment} isLiveActivity={isLiveActivity} />
		</Provider>,
	);
}

describe("WorkSegmentRenderer live activity", () => {
	it("用当前工具阶段取代运行中阶段的笼统标题", () => {
		renderSegment(stage([tool("read", { currentPhase: "正在解析配置文件" })]));

		expect(screen.getByTestId("group-title").textContent).toBe("正在解析配置文件");
		expect(screen.getByTestId("group-status").textContent).toBe("running");
	});

	it("没有工具阶段时优先展示 agent 写的 description", () => {
		renderSegment(stage([tool("grep", { args: { description: "定位消息分组逻辑" } })]));

		expect(screen.getByTestId("group-title").textContent).toBe("定位消息分组逻辑");
	});

	it("没有工具阶段和 description 时回退到语义化工具名", () => {
		renderSegment(stage([tool("read")]));

		expect(screen.getByTestId("group-title").textContent).toBe("工具 read");
	});

	it("没有 pending 工具时展示最新 thinking 的单行尾部摘要", () => {
		const longThinking = `先核对现有行为\n${"继续分析边界条件".repeat(12)}`;
		renderSegment(stage([tool("read", { status: "success" }), thinking(longThinking)]));

		const title = screen.getByTestId("group-title").textContent ?? "";
		expect(title.startsWith("思考：…")).toBe(true);
		expect(title.endsWith("继续分析边界条件")).toBe(true);
		expect(Array.from(title.replace("思考：", ""))).toHaveLength(80);
	});

	it("并行调用时展示最近的仍在执行的工具", () => {
		renderSegment(
			stage([
				tool("read", { toolCallId: "read-1", args: { description: "读取配置" } }),
				tool("grep", { toolCallId: "grep-1", status: "success", args: { description: "搜索入口" } }),
			]),
		);

		expect(screen.getByTestId("group-title").textContent).toBe("读取配置");
	});

	it("阶段完成后恢复稳定 summary，不再展示实时活动", () => {
		renderSegment(
			stage([tool("read", { status: "success", currentPhase: "不应继续展示" })], {
				closed: true,
				summary: "已核对项目结构",
			}),
		);

		expect(screen.getByTestId("group-title").textContent).toBe("已核对项目结构");
		expect(screen.getByTestId("group-status").textContent).toBe("done");
	});

	it("非当前阶段保持 agent 的阶段标题", () => {
		renderSegment(stage([tool("read", { currentPhase: "不应覆盖旧阶段" })]), false);

		expect(screen.getByTestId("group-title").textContent).toBe("核对项目");
	});

	it("组外的裸 thinking 在流式期间也展示内容摘要", () => {
		render(
			<Provider store={createStore()}>
				<WorkSegmentRenderer
					segment={{ type: "single", block: thinking("核对是否需要调整公共协议") }}
					isLiveActivity
				/>
			</Provider>,
		);

		expect(screen.getByTestId("thinking-title").textContent).toBe("思考：核对是否需要调整公共协议");
	});
});
