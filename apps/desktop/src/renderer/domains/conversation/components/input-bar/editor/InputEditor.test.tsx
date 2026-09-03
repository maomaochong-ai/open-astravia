// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { parseInputSegments } from "@shared/lib/input-tokens";
import { describe, expect, it, vi } from "vitest";
import { InputEditor } from "./InputEditor";
import { replaceInputSegments } from "./inputEditorHandle";

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

		await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("Review @C:/workspace/brief.md"));
		expect(screen.getByTitle("C:/workspace/brief.md")).toBeTruthy();
	});
});
