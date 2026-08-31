// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ToolCallBlockView } from "@vetta/theme-ui/chat";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const base = {
	canExpand: true,
	expanded: false,
	exportMode: false,
	icon: "icon-[mdi--file-document-outline]",
	iconColorClass: "text-emerald-400",
	name: "read",
	detail: "src/foo.ts",
	isPending: false,
	showBadge: false,
	body: <pre>file contents</pre>,
	onToggle: vi.fn(),
};

describe("ToolCallBlockView", () => {
	it("hugs the label so the chevron sits on the text's right, and truncates instead of overflowing", () => {
		render(<ToolCallBlockView {...base} />);
		const button = screen.getByRole("button");
		expect(button.className).toContain("inline-flex");
		expect(button.className).toContain("max-w-full");
		expect(button.className).toContain("min-w-0");
		expect(button.className).not.toMatch(/(?:^|\s)w-full(?:\s|$)/);
		expect(button.lastElementChild?.className).toContain("alt-arrow-right");
	});

	it("keeps duration next to the label, not as a colored pill", () => {
		render(<ToolCallBlockView {...base} showBadge badgeLabel="1.2s" />);
		const duration = screen.getByText("1.2s");
		expect(duration.className).toContain("tabular-nums");
		expect(duration.className).not.toContain("bg-primary/10");
		expect(duration.className).not.toContain("bg-muted");
		expect(duration.nextElementSibling?.className).toContain("alt-arrow-right");
	});

	it("does not shimmer the path while pending; only the live phase moves", () => {
		render(<ToolCallBlockView {...base} isPending currentPhase="decoding" showBadge badgeLabel="0.0s" />);
		expect(screen.getByText("src/foo.ts").className).not.toContain("tool-call-shimmer-text");
		expect(screen.getByText("decoding").className).toContain("tool-call-shimmer-text");
		expect(screen.getByText("0.0s")).toBeTruthy();
	});

	it("embedded mode shows the body without a second technical header", () => {
		render(<ToolCallBlockView {...base} embedded body={<div>diff body</div>} />);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByText("read")).toBeNull();
		expect(screen.getByText("diff body")).toBeTruthy();
	});
});
