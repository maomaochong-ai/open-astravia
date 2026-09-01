// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { createStore, Provider } from "jotai";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedSessionPathsAtom } from "@shared/store/atoms";
import project from "@/shared/i18n/locales/en/project.json";
import type {
	DesktopSessionSearchEvent,
	DesktopSessionSearchRequest,
	DesktopSessionSearchSourceKind,
} from "@/shared/session-search";
import { SidebarSessionSearch } from "./SidebarSessionSearch";

const navigate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
beforeEach(() => {
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

async function mountSearch() {
	const i18n = createInstance();
	await i18n.init({ lng: "en", resources: { en: { project } }, interpolation: { escapeValue: false } });
	const calls: {
		request: DesktopSessionSearchRequest;
		emit: (event: DesktopSessionSearchEvent) => void;
		cancel: ReturnType<typeof vi.fn>;
	}[] = [];
	vi.stubGlobal("vetta", {
		session: {
			searchSessions: (request: DesktopSessionSearchRequest, emit: (event: DesktopSessionSearchEvent) => void) => {
				const cancel = vi.fn();
				calls.push({ request, emit, cancel });
				return cancel;
			},
		},
	});
	const user = userEvent.setup();
	const store = createStore();
	const onOpenSession = vi.fn(async () => {});
	render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<SidebarSessionSearch onOpenSession={onOpenSession} />
			</I18nextProvider>
		</Provider>,
	);
	return { user, store, calls, onOpenSession, trigger: screen.getByRole("button", { name: "Search messages" }) };
}

describe("SidebarSessionSearch popover", () => {
	it("applies local calendar presets and keeps their removable chips visible while collapsed", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 31, 14));
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await user.type(screen.getByRole("searchbox"), "budget");
		await waitFor(() => expect(calls.at(-1)?.request.query).toBe("budget"));
		await user.click(screen.getByRole("button", { name: "Filters" }));
		expect(screen.getByRole("combobox", { name: "Time" }).textContent).toContain("Any time");
		for (const [name, from] of [
			["Today", new Date(2026, 7, 31)],
			["Last 7 days", new Date(2026, 7, 25)],
			["Last 30 days", new Date(2026, 7, 2)],
			["This month", new Date(2026, 7, 1)],
		] as const) {
			const previous = calls.at(-1)!;
			fireEvent.keyDown(screen.getByRole("combobox", { name: "Time" }), { key: "Enter" });
			await user.click(screen.getByRole("option", { name }));
			await waitFor(() =>
				expect(calls.at(-1)?.request).toMatchObject({
					query: "budget",
					modifiedFrom: from.getTime(),
					modifiedBefore: new Date(2026, 8, 1).getTime(),
				}),
			);
			expect(previous.cancel).toHaveBeenCalledOnce();
		}
		await user.click(screen.getByRole("button", { name: "Filters (1 active)" }));
		expect(screen.queryAllByRole("combobox")).toHaveLength(0);
		await user.click(screen.getByRole("button", { name: "Remove Time filter: This month" }));
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				query: "budget",
				modifiedFrom: undefined,
				modifiedBefore: undefined,
			}),
		);
	});

	it("selects custom calendar dates, prevents reversed ranges, and includes the end day", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 31, 14));
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await user.type(screen.getByRole("searchbox"), "budget");
		await waitFor(() => expect(calls.at(-1)?.request.query).toBe("budget"));
		const beforeCustom = calls.length;
		await user.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Time" }), { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "Custom dates" }));
		expect(screen.getByRole("alert").textContent).toBe(project.sidebar.search.timeErrors.empty);
		expect(screen.queryByText(project.sidebar.search.noResults)).toBeNull();
		expect(calls).toHaveLength(beforeCustom);
		expect(calls.at(-1)?.cancel).toHaveBeenCalledOnce();
		const start = screen.getByRole("button", { name: "Start date" });
		const end = screen.getByRole("button", { name: "End date" });
		await user.click(end);
		expect(screen.getByRole("dialog", { name: "End date" })).toBeTruthy();
		expect(document.querySelector('input[type="date"]')).toBeNull();
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		await waitFor(() => expect(document.activeElement).toBe(end));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				modifiedFrom: undefined,
				modifiedBefore: new Date(2026, 7, 21).getTime(),
			}),
		);
		await user.click(start);
		expect(screen.getByRole("button", { name: "Friday, August 21, 2026" }).hasAttribute("disabled")).toBe(true);
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog", { name: "Start date" })).toBeNull();
		expect(screen.getByRole("dialog", { name: "Search messages" })).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(start));
		await user.click(start);
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				modifiedFrom: new Date(2026, 7, 20).getTime(),
				modifiedBefore: new Date(2026, 7, 21).getTime(),
			}),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("clears and resets custom dates", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 31, 14));
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await user.type(screen.getByRole("searchbox"), "budget");
		await waitFor(() => expect(calls.at(-1)?.request.query).toBe("budget"));
		await user.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Time" }), { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "Custom dates" }));
		const start = screen.getByRole("button", { name: "Start date" });
		const end = screen.getByRole("button", { name: "End date" });
		await user.click(start);
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		await user.click(end);
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				modifiedFrom: new Date(2026, 7, 20).getTime(),
				modifiedBefore: new Date(2026, 7, 21).getTime(),
			}),
		);
		await user.click(end);
		await user.click(screen.getByRole("button", { name: "Clear date" }));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				modifiedFrom: new Date(2026, 7, 20).getTime(),
				modifiedBefore: undefined,
			}),
		);
		await user.click(end);
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		await user.click(screen.getByRole("button", { name: "Filters (1 active)" }));
		expect(screen.getByRole("button", { name: "Remove Time filter: 2026-08-20 to 2026-08-20" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Reset filters" }));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toMatchObject({
				query: "budget",
				modifiedFrom: undefined,
				modifiedBefore: undefined,
			}),
		);
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
	});

	it("discards time filters when search closes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 31, 14));
		const { user, trigger } = await mountSearch();
		await user.click(trigger);
		await user.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Time" }), { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "Today" }));
		await user.keyboard("{Escape}");
		await user.click(trigger);
		await user.click(screen.getByRole("button", { name: "Filters" }));
		expect(screen.getByRole("combobox", { name: "Time" }).textContent).toContain("Any time");
		expect(screen.queryByLabelText("Start date")).toBeNull();
	});

	it("inserts later-arriving newer matches above old hits and displays their last-message time", async () => {
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await user.type(screen.getByRole("searchbox"), "match");
		await waitFor(() => expect(calls.at(-1)?.request.query).toBe("match"));
		const emit = (name: string, time: number) =>
			act(() =>
				calls.at(-1)!.emit({
					requestId: "hits",
					done: false,
					results: [
						{
							sourceKind: "project",
							sourceCwd: "C:/demo",
							sourceName: "Demo",
							match: { field: "assistantMessage", snippet: "match text" },
							session: {
								id: name,
								path: name,
								name,
								modifiedAt: time,
								cwd: "C:/demo",
								firstMessage: "",
								access: { readHistory: true, resume: true, rename: true, delete: true },
							},
						},
					],
				}),
			);
		emit("Old", new Date(2026, 7, 1, 9).getTime());
		expect(screen.getByRole("listitem").textContent).toContain("Old");
		emit("New", new Date(2026, 7, 31, 15).getTime());
		const rows = screen.getAllByRole("listitem");
		expect(rows[0].textContent).toContain("New");
		expect(rows[1].textContent).toContain("Old");
		expect(rows[0].querySelector("time")?.dateTime).toBe(new Date(2026, 7, 31, 15).toISOString());
		expect(screen.getByText("Newest first")).toBeTruthy();
		await user.click(within(rows[1]).getByRole("button", { name: project.contextMenu.pin }));
		expect(screen.getAllByRole("listitem")[0].textContent).toContain("New");
	});
	it.each(["userMessage", "assistantMessage"] as const)(
		"streams and highlights %s hits, filters, pins and opens a result",
		async (field) => {
			const { user, store, calls, onOpenSession, trigger } = await mountSearch();
			expect(screen.queryByRole("dialog")).toBeNull();
			await user.click(trigger);
			expect(screen.getByRole("dialog", { name: "Search messages" })).toBeTruthy();
			expect(screen.getByText(project.sidebar.search.subtitle)).toBeTruthy();
			expect(screen.getByRole("searchbox", { name: project.sidebar.search.placeholder })).toBeTruthy();
			await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox")));
			expect(screen.queryAllByRole("combobox")).toHaveLength(0);
			await waitFor(() => expect(calls).toHaveLength(1));
			expect(calls[0].request).toMatchObject({ query: "", sourceKind: undefined, projectCwd: undefined });
			act(() =>
				calls[0].emit({ requestId: "1", sources: [{ cwd: "C:/demo", kind: "project", name: "Demo" }], done: true }),
			);
			const filterToggle = screen.getByRole("button", { name: "Filters" });
			await user.click(filterToggle);
			expect(calls).toHaveLength(1);
			fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
			await user.click(await screen.findByRole("option", { name: "Demo" }));
			fireEvent.keyDown(screen.getByRole("combobox", { name: "Type" }), { key: "Enter" });
			await user.click(await screen.findByRole("option", { name: "Project session" }));
			await user.click(filterToggle);
			expect(screen.queryAllByRole("combobox")).toHaveLength(0);
			expect(screen.getByRole("button", { name: "Filters (2 active)" }).getAttribute("aria-expanded")).toBe("false");
			await user.type(screen.getByRole("searchbox"), "budget");
			expect(screen.getByText(project.sidebar.search.loadingDescription)).toBeTruthy();
			await waitFor(() => expect(calls.at(-1)?.request).toMatchObject({ query: "budget", projectCwd: "C:/demo" }));
			const call = calls.at(-1)!;
			act(() =>
				call.emit({
					requestId: "2",
					done: false,
					results: [
						{
							sourceKind: "project",
							sourceCwd: "C:/demo",
							sourceName: "Demo",
							session: {
								id: "one",
								path: "C:/session",
								cwd: "C:/demo",
								name: "Budget",
								firstMessage: "budget",
								modifiedAt: 1,
								access: { readHistory: true, resume: true, rename: true, delete: true },
							},
							match: { field, snippet: "budget proposal" },
						},
					],
				}),
			);
			expect(screen.getByText(project.sidebar.search.loadingMore)).toBeTruthy();
			const resultButton = screen.getByRole("button", { name: /Budget.*budget proposal/ });
			const row = within(screen.getByRole("list", { name: "Search messages" })).getByRole("listitem");
			expect(within(row).queryByText("Project session")).toBeNull();
			expect(within(row).getAllByText("Demo")).toHaveLength(1);
			expect(Array.from(row.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(["Budget", "budget"]);
			await user.click(screen.getByRole("button", { name: project.contextMenu.pin }));
			expect(store.get(pinnedSessionPathsAtom).has("C:/session")).toBe(true);
			expect(onOpenSession).not.toHaveBeenCalled();
			await user.click(resultButton);
			expect(onOpenSession).toHaveBeenCalledWith("C:/demo", "C:/session", undefined);
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			expect(call.cancel).toHaveBeenCalledOnce();
			await user.click(trigger);
			expect(screen.queryAllByRole("combobox")).toHaveLength(0);
			await user.click(screen.getByRole("button", { name: "Filters" }));
			expect(screen.getByRole("combobox", { name: "Project" }).textContent).toContain("All projects");
			await user.keyboard("{Escape}");
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			expect(document.activeElement).toBe(trigger);
			await user.click(trigger);
			expect(screen.queryAllByRole("combobox")).toHaveLength(0);
			expect(screen.getByRole("button", { name: "Filters" }).getAttribute("aria-expanded")).toBe("false");
		},
	);

	it("removes and resets active filters without clearing the query, and keeps collapsed conditions applied", async () => {
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await waitFor(() => expect(calls).toHaveLength(1));
		act(() =>
			calls[0].emit({ requestId: "catalog", sources: [{ cwd: "C:/demo", kind: "project", name: "Demo" }], done: true }),
		);
		await user.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "Demo" }));
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Type" }), { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "Project session" }));
		await user.type(screen.getByRole("searchbox"), "budget");
		await waitFor(() =>
			expect(calls.at(-1)?.request).toEqual({ query: "budget", projectCwd: "C:/demo", sourceKind: "project" }),
		);
		const beforeCollapse = calls.length;
		await user.click(screen.getByRole("button", { name: "Filters (2 active)" }));
		expect(calls).toHaveLength(beforeCollapse);
		expect(screen.queryAllByRole("combobox")).toHaveLength(0);
		const filteredCall = calls.at(-1)!;
		await user.click(screen.getByRole("button", { name: "Remove Project filter: Demo" }));
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
		expect(screen.getByRole("searchbox").getAttribute("value")).toBe("budget");
		await waitFor(() =>
			expect(calls.at(-1)?.request).toEqual({ query: "budget", projectCwd: undefined, sourceKind: "project" }),
		);
		expect(filteredCall.cancel).toHaveBeenCalledOnce();
		expect(screen.getByRole("button", { name: "Filters (1 active)" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Reset filters" }));
		await waitFor(() =>
			expect(calls.at(-1)?.request).toEqual({ query: "budget", projectCwd: undefined, sourceKind: undefined }),
		);
		expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
		await user.click(screen.getByRole("button", { name: "Filters" }));
		expect(screen.getByRole("combobox", { name: "Project" }).textContent).toContain("All projects");
		expect(screen.getByRole("combobox", { name: "Type" }).textContent).toContain("All types");
	});

	it("uses project names for project/batch hits and type names only for non-project hits", async () => {
		const { user, calls, trigger } = await mountSearch();
		await user.click(trigger);
		await user.type(screen.getByRole("searchbox"), "match");
		await waitFor(() => expect(calls.at(-1)?.request.query).toBe("match"));
		const cases: { kind: DesktopSessionSearchSourceKind; name?: string; cwd: string; label: string }[] = [
			{ kind: "project", name: "Demo", cwd: "C:/demo", label: "Demo" },
			{ kind: "batch", name: "Batch project", cwd: "C:/batch", label: "Batch project" },
			{ kind: "project", name: "   ", cwd: "C:/fallback", label: "fallback" },
			{ kind: "conversation", cwd: "C:/default", label: project.filterTabs.conversation },
			{ kind: "claw", cwd: "C:/claw", label: project.filterTabs.claw },
		];
		act(() =>
			calls.at(-1)!.emit({
				requestId: "hits",
				done: true,
				results: cases.map((entry, index) => ({
					sourceKind: entry.kind,
					sourceName: entry.name,
					sourceCwd: entry.cwd,
					session: {
						id: `${index}`,
						path: `C:/session-${index}`,
						cwd: entry.cwd,
						name: `Result ${index}`,
						firstMessage: "",
						modifiedAt: 1,
						access: { readHistory: true, resume: true, rename: true, delete: true },
					},
					match: { field: "assistantMessage", snippet: "match text" },
				})),
			}),
		);
		const rows = within(screen.getByRole("list", { name: "Search messages" })).getAllByRole("listitem");
		for (const [index, entry] of cases.entries()) {
			expect(within(rows[index]).getAllByText(entry.label)).toHaveLength(1);
			expect(within(rows[index]).queryByText(project.sidebar.search.projectType)).toBeNull();
		}
	});
});
