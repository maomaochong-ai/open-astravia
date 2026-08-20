// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMessageView } from "@vetta/theme-ui/chat";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

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
	const onEdit = vi.fn();
	const onFork = vi.fn();
	const onBranchNext = vi.fn();
	render(
		<UserMessageView
			entryState="static"
			displayText="message"
			hasImages={false}
			hasSkillBadge={false}
			hasSettingsAssistBadge={false}
			hasFileBadges={false}
			hasAppshot={false}
			copyText=""
			isLastUserMessage
			showEditAction
			canSwitchBranch
			showForkAction
			isPendingEdit={false}
			branchIndex={0}
			branchTotal={2}
			actionsVisible
			labels={{
				expand: "expand",
				edit: "edit",
				fork: "fork",
				skillBadge: "skill",
				sceneBadge: "scene",
				branchPrev: "previous",
				branchNext: "next",
				branchPosition: "1/2",
				pendingEdit: "pending edit",
			}}
			appshot={null}
			images={null}
			badges={null}
			fileBadges={null}
			textBody={<span>message</span>}
			relativeTime={null}
			copyButton={null}
			onContextMenu={vi.fn()}
			onEdit={onEdit}
			onFork={onFork}
			onBranchPrev={vi.fn()}
			onBranchNext={onBranchNext}
			onActionsVisibleChange={vi.fn()}
		/>,
	);

	expect((screen.getByLabelText("edit") as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByLabelText("fork") as HTMLButtonElement).disabled).toBe(false);
	// Previous remains disabled because it is a real branch boundary, unrelated to Runtime readiness.
	expect((screen.getByLabelText("previous") as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByLabelText("next") as HTMLButtonElement).disabled).toBe(false);

	await user.click(screen.getByLabelText("edit"));
	await user.click(screen.getByLabelText("fork"));
	await user.click(screen.getByLabelText("next"));
	expect(onEdit).toHaveBeenCalledOnce();
	expect(onFork).toHaveBeenCalledOnce();
	expect(onBranchNext).toHaveBeenCalledOnce();
});
