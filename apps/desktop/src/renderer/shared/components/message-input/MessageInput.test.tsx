// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MessageInput } from "@vetta/theme-ui/chat";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => undefined }));

afterEach(cleanup);

describe("MessageInput compound primitives", () => {
	it("composes caller-owned abilities inside shared layout primitives", () => {
		render(
			<MessageInput.Root focused topConnected>
				<MessageInput.Surface data-testid="surface">
					<MessageInput.Content>
						<nav>Members</nav>
						<section data-testid="editor">Editor</section>
						<MessageInput.Toolbar>
							<MessageInput.ToolbarLeading>
								<span>Attach</span>
								<span>Hint</span>
							</MessageInput.ToolbarLeading>
							<MessageInput.ToolbarTrailing>
								<span>Send</span>
							</MessageInput.ToolbarTrailing>
						</MessageInput.Toolbar>
					</MessageInput.Content>
				</MessageInput.Surface>
			</MessageInput.Root>,
		);

		const surface = screen.getByTestId("surface");
		expect(surface.className).toContain("rounded-b-[20px]");
		expect(surface.className).toContain("border-primary/20");
		expect(screen.getByTestId("editor").tagName).toBe("SECTION");
		expect(screen.getByText("Members").tagName).toBe("NAV");
		expect(
			screen.getByText("Attach").compareDocumentPosition(screen.getByText("Hint")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);
	});

	it("allows stateless layout parts to be reused without a nominal Root guard", () => {
		render(
			<MessageInput.Content asChild>
				<section data-testid="content">
					<MessageInput.Toolbar>Actions</MessageInput.Toolbar>
				</section>
			</MessageInput.Content>,
		);

		expect(screen.getByTestId("content").className).toContain("rounded-[inherit]");
		expect(screen.getByText("Actions").className).toContain("justify-between");
	});

	it("merges Surface into the optional DropZone DOM node with asChild", () => {
		render(
			<MessageInput.Root focused={false}>
				<MessageInput.Surface asChild data-testid="surface">
					<MessageInput.DropZone
						dragKind={null}
						enabled
						labels={{ releaseToRef: "Release", internalRef: "Internal", externalRef: "External" }}
						onDragEnter={vi.fn()}
						onDragOver={vi.fn()}
						onDragLeave={vi.fn()}
						onDrop={vi.fn()}
					>
						<MessageInput.Content>Editor</MessageInput.Content>
					</MessageInput.DropZone>
				</MessageInput.Surface>
			</MessageInput.Root>,
		);

		const surface = screen.getByTestId("surface");
		expect(surface.getAttribute("data-vetta-drop-scope")).toBe("input");
		expect(surface.className).toContain("input-card");
		expect(surface.querySelector('[data-theme-surface="chat.inputBar"]')).toBeTruthy();
	});

	it("rejects a primitive detached from its Root state owner", () => {
		expect(() => render(<MessageInput.Surface>Editor</MessageInput.Surface>)).toThrow(
			"MessageInput.Surface must be used within MessageInput.Root",
		);
	});
});
