// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatTimelineEventViewModel } from "@shared/store/atoms";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			const labels: Record<string, string> = {
				"chat.memberActivity.waiting": "等待开始",
				"chat.memberActivity.thinking": "正在思考",
				"chat.memberActivity.processing": "正在处理",
				"chat.memberActivity.processingTool": "正在调用工具",
				"chat.memberActivity.waitingReply": "等待回复",
				"chat.memberActivity.failed": "处理失败",
				"chat.memberActivity.cancelled": "已取消",
				"chat.memberActivity.completed": "已完成",
			};
			if (key === "chat.memberActivity.openSession") return `打开 ${values?.name} 的成员会话`;
			if (key === "chat.memberActivity.recent") return `最近：${values?.text}`;
			return labels[key] ?? key;
		},
	}),
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid="member-avatar">{name}</span>,
	LiveThinkingView: ({ text }: { text: string }) => <div data-testid="live-thinking">{text}</div>,
}));

import { TeamMemberReplyCard } from "./TeamMemberReplyCard";

const event: Extract<ChatTimelineEventViewModel, { kind: "team-member-summary" }> = {
	kind: "team-member-summary",
	requestId: "request-1",
	memberId: "member-1",
	memberName: "研究员",
	memberBlueprintId: "researcher",
	state: "streaming",
	currentKind: "thinking",
	current: "正在检查配置和边界条件",
	recent: ["读取项目配置"],
	timestamp: 1,
};

describe("TeamMemberReplyCard", () => {
	it("adapts to content up to the compact height limit and opens the member session", () => {
		const onOpen = vi.fn();
		render(<TeamMemberReplyCard event={event} onOpen={onOpen} />);

		expect(screen.getByRole("button", { name: "打开 研究员 的成员会话" })).toBeTruthy();
		expect(screen.getByRole("button").className).toContain("h-7");
		expect(screen.getByRole("button").className).toContain("w-7");
		expect(screen.getByTestId("team-member-reply-card").className).toContain("max-h-[240px]");
		expect(screen.getByTestId("team-member-reply-card").className).not.toContain("h-[300px]");
		expect(screen.getByTestId("team-member-reply-card").className).not.toContain("min-h-[300px]");
		expect(screen.getByTestId("live-thinking").parentElement?.className).toContain("overflow-y-auto");
		expect(screen.getByText("最近：读取项目配置").parentElement?.className).toContain("overflow-y-auto");
		expect(screen.getByTestId("live-thinking").textContent).toContain("正在检查配置");
		expect(screen.getByText("最近：读取项目配置")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "打开 研究员 的成员会话" }));
		expect(onOpen).toHaveBeenCalledWith("member-1");
	});
});
