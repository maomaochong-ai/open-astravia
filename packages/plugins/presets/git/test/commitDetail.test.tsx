// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitDetailPane } from "../src/components/graph/CommitDetailPane";
import { CommitRow } from "../src/components/graph/CommitRow";
import { PatchContent } from "../src/components/PatchContent";
import { setGitCommand } from "../src/git/runtime";
import type { CommitNode } from "../src/git/types";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

const node: CommitNode = {
	hash: "a".repeat(40),
	parents: [],
	refs: [],
	authorName: "Author",
	authorEmail: "author@example.com",
	timestamp: 1,
	subject: "Multiple files",
	body: "",
};
const patch = (path: string) =>
	`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${path}\n`;

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(CSSStyleSheet.prototype, "replaceSync", { configurable: true, value() {} });
	// jsdom has no layout; give the virtual tree a measurable browser viewport.
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(192);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 192));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("commit details", () => {
	it("lists every changed file by default and switches the selected diff and view", async () => {
		const run = vi.fn(async (_file: string, args?: string[]) => ({
			exitCode: 0,
			stderr: "",
			stdout: args?.includes("--name-status")
				? args.includes("-z")
					? "M\0src/first.ts\0A\0src/second.ts\0"
					: "M\tsrc/first.ts\nA\tsrc/second.ts\n"
				: patch(args?.at(-1) ?? ""),
		}));
		setGitCommand({ run });
		localStorage.setItem("vetta-git-view-mode", "tree");
		const { container } = render(<CommitDetailPane root="/repo" node={node} onClose={() => {}} />);
		fireEvent.click(await screen.findByRole("button", { name: /second.ts/ }));
		await waitFor(() => expect(run.mock.calls.some(([, args]) => args?.at(-1) === "src/second.ts")).toBe(true));
		await waitFor(() =>
			expect(container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("src/second.ts"),
		);
		expect(screen.getByRole("button", { name: /first.ts/ })).toBeTruthy();
		fireEvent.click(screen.getByTitle("view.switchToTree"));
		expect(container.querySelector("file-tree-container")?.parentElement?.style.height).toBe("192px");
		expect(screen.getByTitle("view.switchToFlat")).toBeTruthy();
		const treeFile = await waitFor(() => {
			const buttons = container.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll("button") ?? [];
			const button = Array.from(buttons).find((item) => item.getAttribute("aria-label") === "first.ts");
			if (!button) throw new Error("First file missing from tree");
			return button;
		});
		fireEvent.click(treeFile);
		await waitFor(() =>
			expect(container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("src/first.ts"),
		);
		fireEvent.click(screen.getByTitle("view.switchToFlat"));
		expect(screen.getByRole("button", { name: /second.ts/ })).toBeTruthy();
	});

	it("ignores a late file inventory after switching to a different commit", async () => {
		let resolveOld: (value: string) => void = () => {};
		const oldFiles = new Promise<string>((resolve) => {
			resolveOld = resolve;
		});
		setGitCommand({
			run: async (_file, args = []) => ({
				exitCode: 0,
				stderr: "",
				stdout: args.includes("--name-status")
					? args.includes(node.hash)
						? await oldFiles
						: "A\0new.txt\0"
					: patch("new.txt"),
			}),
		});
		const { rerender } = render(<CommitDetailPane root="/repo" node={node} onClose={() => {}} />);
		rerender(<CommitDetailPane root="/repo" node={{ ...node, hash: "b".repeat(40) }} onClose={() => {}} />);
		expect(await screen.findByRole("button", { name: /new.txt/ })).toBeTruthy();
		await act(async () => resolveOld("M\0old.txt\0"));
		expect(screen.queryByRole("button", { name: /old.txt/ })).toBeNull();
	});

	it("shows an empty commit explicitly", async () => {
		setGitCommand({ run: async () => ({ exitCode: 0, stderr: "", stdout: "" }) });
		render(<CommitDetailPane root="/repo" node={node} onClose={() => {}} />);
		expect(await screen.findByText("commit.noFiles")).toBeTruthy();
	});

	it("keeps a visible binary-file explanation in the shared renderer", () => {
		render(
			<PatchContent
				patch={"diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n"}
			/>,
		);
		expect(screen.getByText("diff.binary")).toBeTruthy();
	});

	it("does not render author or time on the commit row", () => {
		render(<CommitRow node={node} selected={false} graphWidth={20} top={0} height={24} onSelect={() => {}} />);
		expect(screen.queryByText("Author")).toBeNull();
		expect(screen.getByText(node.subject)).toBeTruthy();
	});
});
