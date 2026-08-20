// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
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

it("Runtime 恢复期间保留消息操作位置但禁用依赖 Runtime 的按钮", () => {
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
			editActionDisabled
			canSwitchBranch
			branchActionDisabled
			showForkAction
			forkActionDisabled
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
			onEdit={vi.fn()}
			onFork={vi.fn()}
			onBranchPrev={vi.fn()}
			onBranchNext={vi.fn()}
			onActionsVisibleChange={vi.fn()}
		/>,
	);

	expect((screen.getByLabelText("edit") as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByLabelText("fork") as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByLabelText("previous") as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByLabelText("next") as HTMLButtonElement).disabled).toBe(true);
});
