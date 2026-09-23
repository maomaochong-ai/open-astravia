// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../src/components/graph/GraphView";
import { setGitCommand } from "../src/git/runtime";

vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
const hash = "a".repeat(40);
const head = "b".repeat(40);

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function setup(loadLog?: (args: string[]) => Promise<string>) {
	let branchExists = false;
	let resetError = false;
	const run = vi.fn(async (_file: string, args: string[] = []) => {
		let stdout = "";
		if (args[0] === "log")
			stdout = `${[hash, "", "", "Author", "author@example.com", "1", "Selected commit", ""].join("\x1f")}\x1e`;
		if (args[0] === "log" && loadLog) stdout = await loadLog(args);
		if (args[0] === "rev-parse") stdout = head;
		if (args[0] === "branch") {
			if (args.includes("--show-current")) stdout = "main";
			else if (args.includes("--")) branchExists = true;
			else stdout = `main ${head}\n${branchExists ? `feature/from-history ${hash}` : ""}`;
		}
		if (args[0] === "reset" && resetError) return { exitCode: 1, stdout: "", stderr: "index.lock" };
		return { exitCode: 0, stdout, stderr: "" };
	});
	setGitCommand({ run });
	const view = render(<GraphView root="/repo" reloadToken={0} />);
	return {
		...view,
		run,
		failReset: () => {
			resetError = true;
		},
	};
}

async function openMenu() {
	fireEvent.contextMenu(await screen.findByRole("button", { name: "Selected commit" }), { clientX: 20, clientY: 30 });
	return screen.findByRole("menu");
}

describe("commit graph actions", () => {
	it("discards an old page response after the graph refreshes", async () => {
		const record = (index: number, subject: string) =>
			`${[index.toString(16).padStart(40, "0"), "", "", "Author", "author@example.com", "1", subject, ""].join("\x1f")}\x1e`;
		let refresh = false;
		let resolvePage: (value: string) => void = () => {};
		const page = new Promise<string>((resolve) => {
			resolvePage = resolve;
		});
		const { container, rerender, run } = setup(async (args) => {
			if (args.includes("--skip=200")) return page;
			return refresh
				? record(201, "Refreshed commit")
				: Array.from({ length: 200 }, (_, i) => record(i, `Original ${i}`)).join("");
		});
		await screen.findByRole("button", { name: "Original 0" });
		const canvas = container.querySelector(".git-graph-canvas");
		if (!canvas) throw new Error("Missing graph scroll viewport");
		fireEvent.scroll(canvas);
		await waitFor(() => expect(run.mock.calls.some(([, args]) => args.includes("--skip=200"))).toBe(true));
		refresh = true;
		rerender(<GraphView root="/repo" reloadToken={1} />);
		await screen.findByRole("button", { name: "Refreshed commit" });
		await act(async () => resolvePage(record(202, "Stale page commit")));
		expect(screen.queryByRole("button", { name: "Stale page commit" })).toBeNull();
	});

	it("creates a branch at the right-clicked commit and refreshes available branches", async () => {
		const { run } = setup();
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "commit.branch" }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog.textContent).toContain(hash);
		expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "commit.execute" }).disabled).toBe(true);
		fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "feature/from-history" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "commit.execute" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			run.mock.calls.some(
				([, args]) => JSON.stringify(args) === JSON.stringify(["branch", "--", "feature/from-history", hash]),
			),
		).toBe(true);
		await waitFor(() => expect(run.mock.calls.filter(([, args]) => args?.[0] === "log").length).toBeGreaterThan(1));
	});

	it.each(["soft", "mixed", "hard"])(
		"confirms %s reset, supports cancellation, and retains the dialog on failure",
		async (mode) => {
			const { run, failReset } = setup();
			await openMenu();
			fireEvent.click(screen.getByRole("menuitem", { name: `commit.reset.${mode}` }));
			let dialog = await screen.findByRole("dialog");
			expect(dialog.textContent).toContain(`commit.reset.${mode}.description`);
			expect(run.mock.calls.some(([, args]) => args?.[0] === "reset")).toBe(false);
			fireEvent.click(within(dialog).getByRole("button", { name: "confirm.cancel" }));
			await openMenu();
			fireEvent.click(screen.getByRole("menuitem", { name: `commit.reset.${mode}` }));
			dialog = await screen.findByRole("dialog");
			failReset();
			fireEvent.click(within(dialog).getByRole("button", { name: "commit.execute" }));
			expect((await screen.findByRole("alert")).textContent).toBe("index.lock");
			expect(
				run.mock.calls.some(
					([, args]) => JSON.stringify(args) === JSON.stringify(["reset", `--${mode}`, hash, "--"]),
				),
			).toBe(true);
			expect(screen.getByRole("dialog")).toBeTruthy();
		},
	);

	it("checks out the selected commit only after confirmation", async () => {
		const { run } = setup();
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "commit.detach" }));
		const dialog = await screen.findByRole("dialog");
		expect(run.mock.calls.some(([, args]) => args?.[0] === "checkout")).toBe(false);
		fireEvent.click(within(dialog).getByRole("button", { name: "commit.execute" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			run.mock.calls.some(([, args]) => JSON.stringify(args) === JSON.stringify(["checkout", "--detach", hash])),
		).toBe(true);
	});
});
