// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const onEdit = vi.fn();
const onFork = vi.fn();
const onBranchNext = vi.fn();

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => ({
			"messageList.editButton": "edit",
			"messageList.forkButton": "fork",
			"messageList.branch.prev": "previous",
			"messageList.branch.next": "next",
		}[key] ?? key),
	}),
}));
vi.mock("../../hooks/useSkillTokenMeta", () => ({ useSkillTokenMeta: () => vi.fn() }));
vi.mock("../../hooks/useUserMessageActions", () => ({
	useUserMessageEditAction: () => ({ available: true, pending: false, onEdit }),
	useUserMessageHistoryActions: () => ({
		branchIndex: 0,
		branchTotal: 2,
		canSwitch: true,
		forkAvailable: true,
		onFork,
		onNext: onBranchNext,
		onPrevious: vi.fn(),
	}),
	useUserMessageDeleteAction: () => ({ available: false, onDelete: vi.fn() }),
	useUserMessageCopyAction: () => vi.fn(async () => undefined),
	useUserMessageContextMenu: () => ({ model: null, onContextMenu: vi.fn() }),
}));

import { UserMessage } from "./UserMessage";
import { TokenChip } from "../input-bar/editor/nodes/TokenChip";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe(): void {}
			disconnect(): void {}
		},
	);
});

afterAll(() => vi.unstubAllGlobals());

it("Runtime 恢复期间消息操作保持可用并立即接受点击", async () => {
	const user = userEvent.setup();
	render(
		<UserMessage
			message={createConversationUserMessage({ id: "user-1", text: "message" })}
			isLastUserMessage
		/>,
	);

	expect((screen.getByLabelText("edit") as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByLabelText("fork") as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByLabelText("previous") as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByLabelText("next") as HTMLButtonElement).disabled).toBe(false);
	const outgoing = document.querySelector("[data-message-layout='outgoing']");
	expect(outgoing?.className).toContain("justify-end");

	await user.click(screen.getByLabelText("edit"));
	await user.click(screen.getByLabelText("fork"));
	await user.click(screen.getByLabelText("next"));
	expect(onEdit).toHaveBeenCalledOnce();
	expect(onFork).toHaveBeenCalledOnce();
	expect(onBranchNext).toHaveBeenCalledOnce();
});

it("已发送的成员 mention 与输入框复用同一枚 Token 视觉组件", () => {
	const { container } = render(
		<>
			<TokenChip label="@Architect" title="composer-token" tone="member" />
			<UserMessage
				message={{
					...createConversationUserMessage({ id: "user-mention", text: "**请** @architect 你好" }),
					memberMentions: [
						{ participantId: "architect", handle: "architect", start: 6, end: 16 },
					],
				}}
				participants={[
					{
						id: "architect",
						kind: "agent",
						name: "Architect",
						handle: "architect",
						avatar: "./architect.webp",
					},
				]}
			/>
		</>,
	);

	expect(screen.getAllByText("@Architect")).toHaveLength(2);
	expect(screen.getByTitle("Architect · @architect").querySelector("img")?.getAttribute("src")).toBe(
		"./architect.webp",
	);
	const tokens = container.querySelectorAll<HTMLElement>("[data-inline-token='true']");
	expect(tokens).toHaveLength(2);
	expect(tokens[1]?.className).toBe(tokens[0]?.className);
	expect(screen.getByText("请").tagName).toBe("STRONG");
});

it("普通 Markdown 中手敲的 @handle 不会被猜测为成员 Token", () => {
	const { container } = render(
		<UserMessage
			message={createConversationUserMessage({ id: "plain-at", text: "**请** @architect 你好" })}
			participants={[{ id: "architect", kind: "agent", name: "Architect", handle: "architect" }]}
		/>,
	);

	expect(container.querySelector("[data-inline-token='true']")).toBeNull();
	expect(screen.getByText("@architect 你好")).toBeTruthy();
});

it("发送前选择为普通文件的 png 在消息气泡中仍显示文件 Token", () => {
	const path = "C:/workspace/screenshot.png";
	const { container } = render(
		<UserMessage
			message={createConversationUserMessage({
				id: "png-file",
				text: `检查 @${path} 然后调整`,
				inputSegments: [
					{ kind: "text", text: "检查 " },
					{ kind: "file", path },
					{ kind: "text", text: " 然后调整" },
				],
				attachments: [{ kind: "file", path }],
			})}
		/>,
	);

	expect(screen.getByTitle(path).textContent).toContain("screenshot.png");
	expect(container.querySelectorAll("[data-inline-token='true']")).toHaveLength(1);
	expect(container.querySelector("img")).toBeNull();
});

it("结构化快照中的普通正文不会在 Markdown 层被二次识别", () => {
	const text = "原样保留 @C:/workspace/screenshot.png";
	const { container } = render(
		<UserMessage
			message={createConversationUserMessage({
				id: "plain-token-shape",
				text,
				inputSegments: [{ kind: "text", text }],
			})}
		/>,
	);

	expect(container.querySelector("[data-inline-token='true']")).toBeNull();
	expect(screen.getByText(text)).toBeTruthy();
});

it("本地 Markdown 链接规范化后仍按原始编辑器区间渲染相邻 Token", () => {
	const prefix = "[文档](C:/My Files/spec.md) ";
	const text = `${prefix}@skill:review`;
	const { container } = render(
		<UserMessage
			message={createConversationUserMessage({
				id: "link-before-token",
				text,
				inputSegments: [
					{ kind: "text", text: prefix },
					{ kind: "skill", name: "review" },
				],
			})}
		/>,
	);

	expect(screen.getByTitle("review").textContent).toContain("review");
	expect(container.querySelectorAll("[data-inline-token='true']")).toHaveLength(1);
});
