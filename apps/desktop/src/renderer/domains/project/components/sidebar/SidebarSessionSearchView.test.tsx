// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { compile } from "tailwindcss";
import type { SidebarSessionSearchViewItem, SidebarSessionSearchViewProps } from "@vetta/theme-ui/project";
import { SidebarSessionSearchView } from "@vetta/theme-ui/project";
import { describe, expect, it, vi } from "vitest";
import project from "@/shared/i18n/locales/en/project.json";

const labels = {
	title: "Search messages",
	subtitle: "Titles, your messages and Agent text replies",
	close: "Close",
	project: "Project",
	type: "Type",
	status: "1 conversation found",
	partial: "",
	clear: "Clear",
	emptyQuery: "Type a query",
	error: "Error",
	loading: "Loading",
	loadingDescription: "Results appear as they are found",
	loadingMore: "Still searching — open results now",
	noResults: "No results",
	pin: "Pin",
	placeholder: "Search titles and conversation text",
	unpin: "Unpin",
	filters: "Filters",
	filtersActive: "Filters (1 active)",
	resetFilters: "Reset filters",
	time: "Time",
	startDate: "Start date",
	endDate: "End date",
	timeHint: "Local dates, inclusive end day",
	newestFirst: "Newest first",
	invalidFilters: "Adjust the time range to continue searching",
};

function props(overrides: Partial<SidebarSessionSearchViewProps> = {}): SidebarSessionSearchViewProps {
	return {
		error: false,
		items: [],
		activeFilters: [],
		filtersExpanded: false,
		timeFilter: {
			value: "all",
			options: [
				{ key: "all", label: "Any time" },
				{ key: "custom", label: "Custom dates" },
			],
			datePicker: { labels: project.sidebar.search.calendar },
			onValueChange: vi.fn(),
			onStartDateChange: vi.fn(),
			onEndDateChange: vi.fn(),
		},
		onToggleFilters: vi.fn(),
		onResetFilters: vi.fn(),
		projectOptions: [{ key: "all", label: "All projects" }],
		typeOptions: [{ key: "all", label: "All types" }],
		labels,
		loading: false,
		onClose: vi.fn(),
		onQueryChange: vi.fn(),
		query: "ship",
		selectedProject: "all",
		selectedType: "all",
		onProjectChange: vi.fn(),
		onTypeChange: vi.fn(),
		...overrides,
	};
}

function item(): SidebarSessionSearchViewItem {
	return {
		key: "one",
		title: "Ship roadmap",
		titleHighlights: [{ start: 0, end: 4 }],
		sourceLabel: "Demo",
		timeLabel: "2026/08/31 12:00",
		timeTitle: "Last message: 2026/08/31 12:00",
		timeDateTime: "2026-08-31T04:00:00.000Z",
		snippet: "ship it",
		snippetHighlights: [{ start: 0, end: 4 }],
		pinned: false,
		onOpen: vi.fn(),
		onTogglePin: vi.fn(),
	};
}

describe("SidebarSessionSearchView", () => {
	it("shows loading in the main region before any result and keeps incremental results interactive", async () => {
		const user = userEvent.setup();
		const initial = props({ loading: true });
		const { rerender } = render(<SidebarSessionSearchView {...initial} />);
		const region = screen.getByRole("region", { name: labels.title });
		expect(within(region).getByText(labels.loading)).toBeTruthy();
		expect(within(region).getByText(labels.loadingDescription)).toBeTruthy();
		expect(screen.queryByText(labels.noResults)).toBeNull();

		const result = item();
		rerender(<SidebarSessionSearchView {...initial} items={[result]} />);
		expect(within(region).getByText(labels.loadingMore)).toBeTruthy();
		expect(screen.queryByText(labels.loadingDescription)).toBeNull();
		const open = screen.getByRole("button", { name: /Ship roadmap/ });
		const row = screen.getByRole("listitem");
		expect(within(row).queryByText("Project session")).toBeNull();
		expect(within(row).getAllByText("Demo")).toHaveLength(1);
		expect(Array.from(row.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(["Ship", "ship"]);
		await user.click(open);
		await user.click(screen.getByRole("button", { name: labels.pin }));
		expect(result.onOpen).toHaveBeenCalledOnce();
		expect(result.onTogglePin).toHaveBeenCalledOnce();

		rerender(<SidebarSessionSearchView {...initial} loading={false} items={[result]} />);
		expect(screen.queryByText(labels.loadingMore)).toBeNull();
		expect(screen.getByRole("status").textContent).toContain(labels.status);
		expect(screen.getByRole("button", { name: /Ship roadmap/ })).toBeTruthy();
	});

	it("distinguishes the initial hint, finished empty results and search failures", () => {
		const initial = props({ query: "", loading: true });
		const { rerender } = render(<SidebarSessionSearchView {...initial} />);
		expect(screen.getByText(labels.emptyQuery)).toBeTruthy();
		expect(screen.queryByText(labels.loading)).toBeNull();
		rerender(<SidebarSessionSearchView {...initial} query="missing" loading={false} />);
		expect(screen.getByText(labels.noResults)).toBeTruthy();
		rerender(<SidebarSessionSearchView {...initial} query="missing" error loading={false} />);
		expect(screen.getByRole("alert").textContent).toBe(labels.error);
		expect(screen.queryByText(labels.noResults)).toBeNull();
	});

	it("keeps partial hits visible alongside errors and the incomplete-history warning", () => {
		render(
			<SidebarSessionSearchView
				{...props({ error: true, items: [item()], labels: { ...labels, partial: "Some history unavailable" } })}
			/>,
		);
		expect(screen.getByRole("alert").textContent).toBe(labels.error);
		expect(screen.getByRole("button", { name: /Ship roadmap/ })).toBeTruthy();
		expect(screen.getByRole("status").textContent).toContain("Some history unavailable");
	});

	it("renders matched markup as text, never as HTML", () => {
		const result = { ...item(), snippet: "<img src=x onerror=alert(1)>", snippetHighlights: [{ start: 1, end: 4 }] };
		const { container } = render(<SidebarSessionSearchView {...props({ items: [result] })} />);
		expect(container.querySelector("img")).toBeNull();
		expect(screen.getByRole("button", { name: /Ship roadmap/ }).getAttribute("aria-labelledby")).toBeTruthy();
		expect(screen.getByRole("listitem").textContent).toContain(result.snippet);
	});

	it("wires query editing, clear and close controls", async () => {
		const user = userEvent.setup();
		const initial = props({ query: "" });
		const { rerender } = render(<SidebarSessionSearchView {...initial} />);
		const input = screen.getByRole("searchbox", { name: labels.placeholder });
		expect(input.getAttribute("data-slot")).toBe("input");
		expect(input.getAttribute("maxlength")).toBe("200");
		await user.type(input, "a");
		expect(initial.onQueryChange).toHaveBeenCalledWith("a");
		rerender(<SidebarSessionSearchView {...initial} query="abc" />);
		await user.click(screen.getByRole("button", { name: labels.clear }));
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
		await user.click(screen.getByRole("button", { name: labels.close }));
		expect(initial.onQueryChange).toHaveBeenCalledWith("");
		expect(initial.onClose).toHaveBeenCalledOnce();
	});

	it("suppresses the browser cancel control while keeping one accessible clear button", async () => {
		const user = userEvent.setup();
		const initial = props({ query: "abc" });
		const { rerender } = render(<SidebarSessionSearchView {...initial} />);
		const input = screen.getByRole("searchbox", { name: labels.placeholder });
		// jsdom cannot paint Chromium's native control; verify its compiled CSS contract.
		const cancelClasses = Array.from(input.classList).filter((name) => name.includes("::-webkit-search-cancel-button"));
		const compiler = await compile("@tailwind utilities;");
		expect(compiler.build(cancelClasses)).toMatch(/::-webkit-search-cancel-button\s*\{\s*display:\s*none;/);
		expect(input.getAttribute("type")).toBe("search");
		expect(screen.getAllByRole("button", { name: labels.clear })).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: labels.clear }));
		expect(initial.onQueryChange).toHaveBeenCalledWith("");
		rerender(<SidebarSessionSearchView {...initial} query="" />);
		expect(screen.queryByRole("button", { name: labels.clear })).toBeNull();
		expect(document.activeElement).toBe(input);
	});

	it("keeps row opening and pinning separate in keyboard order, before the source label", async () => {
		const user = userEvent.setup();
		const result = item();
		const { rerender, container } = render(<SidebarSessionSearchView {...props({ items: [result] })} />);
		const open = screen.getByRole("button", { name: /Ship roadmap/ });
		const pin = screen.getByRole("button", { name: labels.pin });
		expect(container.querySelector("button button")).toBeNull();
		expect(
			pin.compareDocumentPosition(screen.getByText(result.sourceLabel)) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		open.focus();
		await user.keyboard("{Enter}");
		await user.tab();
		expect(document.activeElement).toBe(pin);
		await user.keyboard(" ");
		expect(result.onTogglePin).toHaveBeenCalledOnce();
		expect(result.onOpen).toHaveBeenCalledOnce();
		rerender(<SidebarSessionSearchView {...props({ items: [{ ...result, pinned: true }] })} />);
		const unpin = screen.getByRole("button", { name: labels.unpin });
		expect(unpin.getAttribute("aria-pressed")).toBe("true");
		await user.click(unpin);
		expect(result.onTogglePin).toHaveBeenCalledTimes(2);
		expect(result.onOpen).toHaveBeenCalledOnce();
	});

	it("preserves full long titles and source names in the accessible row name and hover text", () => {
		const result = { ...item(), title: "Long title ".repeat(30), sourceLabel: "Long project ".repeat(30) };
		render(<SidebarSessionSearchView {...props({ items: [result] })} />);
		const open = screen.getByRole("button", { name: /Long title.*Long project/ });
		expect(open.getAttribute("title")).toBe(`${result.title}\n${result.sourceLabel}\n${result.timeTitle}`);
		expect(screen.getByLabelText(result.timeTitle).getAttribute("datetime")).toBe(result.timeDateTime);
		expect(screen.getByRole("listitem").textContent).toContain(result.sourceLabel);
	});

	it("discloses filters on demand and lets collapsed active chips remove or reset conditions", async () => {
		const user = userEvent.setup();
		const initial = props();
		const { rerender } = render(<SidebarSessionSearchView {...initial} />);
		const toggle = screen.getByRole("button", { name: labels.filters });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryAllByRole("combobox")).toHaveLength(0);
		toggle.focus();
		await user.keyboard("{Enter}");
		expect(initial.onToggleFilters).toHaveBeenCalledOnce();
		rerender(<SidebarSessionSearchView {...initial} filtersExpanded />);
		expect(screen.getAllByRole("combobox")).toHaveLength(3);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Type" }));

		const onRemove = vi.fn();
		rerender(
			<SidebarSessionSearchView
				{...initial}
				activeFilters={[{ key: "project", label: "Demo", removeLabel: "Remove Project filter: Demo", onRemove }]}
			/>,
		);
		expect(screen.queryAllByRole("combobox")).toHaveLength(0);
		expect(screen.getByRole("button", { name: labels.filtersActive }).getAttribute("aria-expanded")).toBe("false");
		await user.click(screen.getByRole("button", { name: "Remove Project filter: Demo" }));
		expect(onRemove).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
		await user.click(screen.getByRole("button", { name: labels.resetFilters }));
		expect(initial.onResetFilters).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
	});
});
