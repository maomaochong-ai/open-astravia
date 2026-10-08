// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as ThemeChat from "@vetta-org/theme-ui/chat";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
			if (key === "messageList.duration.seconds") return `${values?.seconds}秒`;
			return labels[key] ?? key;
		},
	}),
}));

const view = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));
vi.mock("@vetta-org/theme-ui/chat/TeamMemberReplyCardView", async (importOriginal) => {
	const actual = await importOriginal<typeof ThemeChat>();
	return {
		...actual,
		TeamMemberReplyCardView: (props: ComponentProps<typeof actual.TeamMemberReplyCardView>) => {
			view.props = props as unknown as Record<string, unknown>;
			return <actual.TeamMemberReplyCardView {...props} />;
		},
	};
});

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
	durationSeconds: 42,
};

afterEach(cleanup);

describe("TeamMemberReplyCard", () => {
	it("maps a member summary onto the card's labels and opens that member", () => {
		const onOpen = vi.fn();
		render(<TeamMemberReplyCard event={event} onOpen={onOpen} />);

		expect(view.props).toMatchObject({
			memberName: "研究员",
			state: "streaming",
			statusLabel: "正在思考",
			durationLabel: "42秒",
			activity: "正在检查配置和边界条件",
			thinking: "正在检查配置和边界条件",
			recentLabel: "最近：读取项目配置",
			openLabel: "打开 研究员 的成员会话",
		});
		(view.props?.onOpen as () => void)();
		expect(onOpen).toHaveBeenCalledWith("member-1");
	});

	it("reveals the member's live activity when expanded", () => {
		render(<TeamMemberReplyCard event={event} />);
		const toggle = screen.getByRole("button", { expanded: false });
		expect(screen.queryByText("最近：读取项目配置")).toBeNull();

		fireEvent.click(toggle);
		expect(screen.getByRole("button", { expanded: true })).toBe(toggle);
		expect(screen.getByText("最近：读取项目配置")).toBeTruthy();
	});

	it("prefers the result once completed and offers no open action without a handler", () => {
		render(<TeamMemberReplyCard event={{ ...event, state: "completed", result: "结论", currentKind: undefined }} />);

		expect(view.props).toMatchObject({ statusLabel: "已完成", activity: "结论" });
		expect(view.props).not.toHaveProperty("thinking");
		expect(view.props).not.toHaveProperty("onOpen");
	});
});
