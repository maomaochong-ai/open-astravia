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
