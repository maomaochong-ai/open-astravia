// @vitest-environment jsdom
import { BashTerminal, ProgressGroup, ToolCall } from "@vetta/theme-ui/chat";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function renderToolCall({
	expanded = false,
	pending = false,
	onToggle = vi.fn(),
}: {
	expanded?: boolean;
	pending?: boolean;
	onToggle?: () => void;
} = {}) {
	return render(
		<ToolCall.Root
			canExpand
			expanded={expanded}
			exportMode={false}
			onToggle={onToggle}
		>
			<ToolCall.Frame>
				<ToolCall.Trigger>
					<ToolCall.StatusIcon
						pending={pending}
						icon="icon-[mdi--file-document-outline]"
						iconColorClass="text-emerald-400"
					/>
					<ToolCall.Name>read</ToolCall.Name>
					<ToolCall.Detail>src/foo.ts</ToolCall.Detail>
					{pending ? <ToolCall.Phase>decoding</ToolCall.Phase> : null}
					<ToolCall.Badge>1.2s</ToolCall.Badge>
					<ToolCall.Chevron />
				</ToolCall.Trigger>
				<ToolCall.Content>
					<pre>file contents</pre>
				</ToolCall.Content>
			</ToolCall.Frame>
		</ToolCall.Root>,
	);
}

describe("ToolCall compound primitives", () => {
	it("keeps the row visual and expansion behavior independently composable", async () => {
		const onToggle = vi.fn();
		renderToolCall({ onToggle });
		const button = screen.getByRole("button");
		expect(button.className).toContain("inline-flex");
		expect(button.className).toContain("max-w-full");
		expect(button.className).not.toMatch(/(?:^|\s)w-full(?:\s|$)/);
		expect(button.lastElementChild?.className).toContain("alt-arrow-right");
		await userEvent.click(button);
		expect(onToggle).toHaveBeenCalledOnce();
	});

	it("lets the caller mount duration and live phase as separate capabilities", () => {
		renderToolCall({ pending: true });
		const duration = screen.getByText("1.2s");
		expect(duration.className).toContain("tabular-nums");
		expect(screen.getByText("src/foo.ts").className).not.toContain("tool-call-shimmer-text");
		expect(screen.getByText("decoding").className).toContain("tool-call-shimmer-text");
	});

	it("offers an explicit embedded layout instead of an embedded feature prop", () => {
		render(
			<ToolCall.Embedded>
				<div>diff body</div>
			</ToolCall.Embedded>,
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByText("diff body")).toBeTruthy();
	});

	it("rejects behavior primitives outside their Root", () => {
		expect(() => render(<ToolCall.Chevron />)).toThrow(
			"ToolCall.Chevron must be used within ToolCall.Root",
		);
	});
});

describe("message content compound primitives", () => {
	it("composes terminal actions and background content without ReactNode region props", () => {
		render(
			<BashTerminal.Root
				command="bun test"
				result="passed"
				status="success"
				startedAt={1}
				durationMs={10}
				startedAtLabel="00:00"
				durationLabel="10ms"
				headerLabel="Shell"
				labels={{ executing: "Running", meta: "meta", metaDescription: "Details" }}
			>
				<BashTerminal.Card>
					<BashTerminal.Header>
						<BashTerminal.StatusDot />
						<BashTerminal.HeaderLabel />
						<BashTerminal.CopyAction>
							<button type="button">Copy command</button>
						</BashTerminal.CopyAction>
					</BashTerminal.Header>
					<BashTerminal.Command />
					<BashTerminal.Result />
					<BashTerminal.Meta />
				</BashTerminal.Card>
			</BashTerminal.Root>,
		);
		expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
		expect(screen.getByText("passed")).toBeTruthy();
		expect(screen.getByText("10ms")).toBeTruthy();
	});

	it("mounts a progress-row detail as a child capability", async () => {
		render(
			<ProgressGroup.RowRoot>
				<ProgressGroup.RowFrame>
					<ProgressGroup.RowTrigger>
						<ProgressGroup.RowStatus status="success" />
						<ProgressGroup.RowText>Read config</ProgressGroup.RowText>
						<ProgressGroup.RowChevron />
					</ProgressGroup.RowTrigger>
					<ProgressGroup.RowContent>config body</ProgressGroup.RowContent>
				</ProgressGroup.RowFrame>
			</ProgressGroup.RowRoot>,
		);
		const trigger = screen.getByRole("button", { name: "Read config" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		await userEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("config body")).toBeTruthy();
	});
});
