// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitTurnCard } from "../src/components/GitTurnCard";
import {
	clearPanelFocus,
	clearPanelShowAll,
	peekPanelFocus,
	peekPanelShowAll,
	setGitCommand,
	setPanelOpener,
	setPanelResizer,
	setTurnDelta,
} from "../src/git/runtime";
import type { ChangeEntry } from "../src/git/types";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
	useActiveConversation: () => ({ cwd: "/repo" }),
}));

const MODIFIED: ChangeEntry = { path: "src/app.ts", code: "M" };

beforeEach(() => {
	setGitCommand({
		run: vi.fn(async (_file: string, args: string[] = []) => {
			if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return { exitCode: 0, stdout: "/repo\n", stderr: "" };
			return { exitCode: 0, stdout: "", stderr: "" };
		}),
	});
});

afterEach(() => {
	cleanup();
	clearPanelFocus(MODIFIED.path);
	clearPanelShowAll("/repo");
	setTurnDelta("/repo", null);
});

/** Render the card with a pre-seeded delta, as if the previous turn just ended. */
function setup(entries: ChangeEntry[]): { opener: ReturnType<typeof vi.fn>; resizer: ReturnType<typeof vi.fn> } {
	const opener = vi.fn();
	const resizer = vi.fn();
	setPanelOpener(opener);
	setPanelResizer(resizer);
	setTurnDelta("/repo", { entries, additions: 3, deletions: 1 });
	render(<GitTurnCard />);
	return { opener, resizer };
}

describe("turn card → Git panel", () => {
	it("opens the panel on the conversation's workspace, widens it and focuses the clicked file", async () => {
		const { opener, resizer } = setup([MODIFIED]);

		fireEvent.click(await screen.findByRole("button", { name: /src\/app\.ts|app\.ts/ }));

		expect(opener).toHaveBeenCalledWith({ cwd: "/repo" });
		await waitFor(() => expect(peekPanelFocus("/repo")).toBe(MODIFIED.path));
		// 窄面板里 diff 区根本不渲染，必须先把面板拓到最宽，否则点了等于没反应。
		expect(resizer).toHaveBeenCalledWith("max");
		expect(peekPanelShowAll("/repo")).toBe(false);
	});

	it("asks for the whole list, not a file focus, for the header and view-all rows", async () => {
		const entries: ChangeEntry[] = Array.from({ length: 12 }, (_, index) => ({
			path: `src/file-${index.toString().padStart(2, "0")}.ts`,
			code: "M",
		}));
		const { opener } = setup(entries);

		fireEvent.click(await screen.findByRole("button", { name: "turnCard.viewAll" }));
		expect(opener).toHaveBeenLastCalledWith({ cwd: "/repo" });
		await waitFor(() => expect(peekPanelShowAll("/repo")).toBe(true));
		expect(peekPanelFocus("/repo")).toBeNull();

		clearPanelShowAll("/repo");
		fireEvent.click(screen.getByRole("button", { name: "turnCard.summary" }));
		expect(opener).toHaveBeenLastCalledWith({ cwd: "/repo" });
		// 面板已在前台时，「查看所有变更」必须仍有可见效果：请求整份列表而不是只开面板。
		await waitFor(() => expect(peekPanelShowAll("/repo")).toBe(true));
		expect(peekPanelFocus("/repo")).toBeNull();
	});
});
