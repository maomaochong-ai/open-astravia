// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { parseInputSegments } from "@shared/lib/input-tokens";
import { describe, expect, it, vi } from "vitest";
import { InputEditor } from "./InputEditor";
import { insertMemberToken, replaceInputSegments } from "./inputEditorHandle";

describe("InputEditor controlled token mode", () => {
	it("renders a connector-owned file reference with the existing file token node", async () => {
		const onValueChange = vi.fn();
		render(
			<InputEditor
				ariaLabel="Prompt"
				editable
				namespace="team-session"
				value="Review @C:/workspace/brief.md"
				history={[]}
				onValueChange={onValueChange}
				onContextMenu={vi.fn()}
				onEnter={() => false}
				onFocusChange={vi.fn()}
				onTriggerChange={vi.fn()}
			/>,
		);

		await waitFor(() => expect(screen.getByTitle("C:/workspace/brief.md")).toBeTruthy());
		expect(screen.getByText("brief.md")).toBeTruthy();
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("routes shared editor commands back through a connector-owned value", async () => {
		const onValueChange = vi.fn();
		render(
			<InputEditor
				ariaLabel="Prompt"
				editable
				namespace="team-session-command"
				value=""
				history={[]}
				onValueChange={onValueChange}
				onContextMenu={vi.fn()}
				onEnter={() => false}
				onFocusChange={vi.fn()}
			/>,
		);

		await act(async () => {
			replaceInputSegments(parseInputSegments("Review @C:/workspace/brief.md").segments);
		});

		await waitFor(() =>
			expect(onValueChange).toHaveBeenCalledWith("Review @C:/workspace/brief.md", expect.any(Array)),
		);
		expect(screen.getByTitle("C:/workspace/brief.md")).toBeTruthy();
	});

	it("renders selected members as a distinct inline token while projecting @handle text", async () => {
		const onValueChange = vi.fn();
		render(
			<InputEditor
				ariaLabel="Prompt"
				editable
				namespace="team-member-token"
				value=""
				history={[]}
				onValueChange={onValueChange}
				onContextMenu={vi.fn()}
				onEnter={() => false}
				onFocusChange={vi.fn()}
			/>,
		);

		await act(async () => {
			insertMemberToken("member-research", "research", "Research", "./avatar.webp", "Leader");
		});

		await waitFor(() => expect(screen.getByTitle("Research · Leader")).toBeTruthy());
		expect(screen.getByText("@Research")).toBeTruthy();
		await waitFor(() =>
			expect(onValueChange).toHaveBeenCalledWith(
				"@research ",
				expect.arrayContaining([
					expect.objectContaining({ kind: "member", memberId: "member-research", handle: "research" }),
				]),
			),
		);
	});

	it("updates token semantics when the controlled text itself stays unchanged", async () => {
		const onValueChange = vi.fn();
		const commonProps = {
			ariaLabel: "Prompt",
			editable: true,
			namespace: "team-member-scope-switch",
			value: "@research",
			history: [],
			onValueChange,
			onContextMenu: vi.fn(),
			onEnter: () => false,
			onFocusChange: vi.fn(),
			onTriggerChange: vi.fn(),
		} as const;
		const { rerender } = render(<InputEditor {...commonProps} />);

		expect(screen.queryByTitle("Research · Leader")).toBeNull();
		rerender(
			<InputEditor
				{...commonProps}
				segments={[
					{
						kind: "member",
						memberId: "member-research",
						handle: "research",
						label: "Research",
						meta: "Leader",
					},
				]}
			/>,
		);

		await waitFor(() => expect(screen.getByTitle("Research · Leader")).toBeTruthy());
		rerender(<InputEditor {...commonProps} segments={[{ kind: "text", text: "@research" }]} />);
		await waitFor(() => expect(screen.queryByTitle("Research · Leader")).toBeNull());
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
