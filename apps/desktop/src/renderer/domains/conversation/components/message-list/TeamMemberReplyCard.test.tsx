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
	AgentAvatarView: () => <span data-testid="member-avatar" />,
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
	it("keeps identity and status visible while collapsed, and reveals activity on click", () => {
		const onOpen = vi.fn();
		render(<TeamMemberReplyCard event={event} onOpen={onOpen} />);

		const avatar = screen.getByTestId("member-avatar");
		const memberName = screen.getByText("研究员");
		expect(avatar.parentElement).toBe(memberName.parentElement);
		expect(avatar.parentElement?.className).toContain("items-center");
		expect(screen.getByTestId("team-member-reply-card").contains(avatar)).toBe(true);
		// 默认折叠：只留身份行，活动详情不渲染。
		const toggle = screen.getByRole("button", { expanded: false });
		expect(screen.queryByTestId("live-thinking")).toBeNull();
		expect(screen.queryByText("最近：读取项目配置")).toBeNull();

		fireEvent.click(toggle);
		expect(screen.getByRole("button", { expanded: true })).toBe(toggle);
		expect(screen.getByTestId("live-thinking").textContent).toContain("正在检查配置");
		expect(screen.getByTestId("live-thinking").parentElement?.className).toContain("overflow-y-auto");
		expect(screen.getByText("最近：读取项目配置")).toBeTruthy();
		expect(screen.getByTestId("live-thinking").parentElement?.parentElement?.className).toContain("max-h-[240px]");

		fireEvent.click(toggle);
		expect(screen.queryByTestId("live-thinking")).toBeNull();

		const openButton = screen.getByRole("button", { name: "打开 研究员 的成员会话" });
		expect(openButton.className).toContain("h-7");
		expect(openButton.className).toContain("w-7");
		fireEvent.click(openButton);
		expect(onOpen).toHaveBeenCalledWith("member-1");
	});
});
