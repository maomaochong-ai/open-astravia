// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";
import type { DesktopSessionSearchResult } from "@/shared/session-search";

const navigate = vi.hoisted(() => vi.fn());
const sessionSearchState = vi.hoisted(() => ({
	results: [] as DesktopSessionSearchResult[],
	loading: false,
	error: false,
	limited: false,
	skipped: 0,
	sources: [],
}));
const scopeBindings = vi.hoisted(() => ({ current: [] as { key: string; run: () => void }[] }));
const projectSessions = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../project/hooks/useSessionSearch", () => ({
	useSessionSearch: () => sessionSearchState,
}));
vi.mock("../../plugins/runtime/plugin-i18n", () => ({
	usePluginTextResolver: () => (_pluginId: string, raw: string) => raw,
}));
vi.mock("@shared/shortcuts", () => ({
	useShortcutScope: ({ active, bindings }: { active: boolean; bindings: { key: string; run: () => void }[] }) => {
		if (active) scopeBindings.current = bindings;
	},
}));
vi.mock("react-i18next", () => ({
	// 文案直接回显 key，断言看的是行为不是译文。
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { commandMenuOpenAtom, projectsAtom } from "@shared/store/atoms";
import { useCommandMenuModel } from "./useCommandMenuModel";

function sessionResult(path: string, title: string): DesktopSessionSearchResult {
	return {
		session: {
			id: path,
			path,
			cwd: "/w",
			name: title,
			firstMessage: "",
			modifiedAt: 1,
			access: { readHistory: true, resume: true, rename: true, delete: true },
		},
		sourceCwd: "/w/proj",
		sourceKind: "project",
		sourceName: "Proj",
		match: { field: "title", snippet: title },
	};
}

const store = getDefaultStore();

function press(key: string): void {
	const binding = scopeBindings.current.find((entry) => entry.key === key);
	if (!binding) throw new Error(`no binding for ${key}`);
	act(() => binding.run());
}

function render() {
	return renderHook(() => useCommandMenuModel({ onOpenSession: vi.fn(async () => undefined) }));
}

beforeEach(() => {
	navigate.mockReset();
	scopeBindings.current = [];
	sessionSearchState.results = [];
	sessionSearchState.loading = false;
	projectSessions.current = [];
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			skills: { list: async () => [] },
			plugins: { listAll: async () => [] },
			session: { listSessions: async () => projectSessions.current },
			// 面板打开后会去读生效的开关键；默认绑定即 mod+k。
			config: { get: async () => ({}), onShortcutsChanged: () => () => undefined },
		},
	});
	store.set(commandMenuOpenAtom, true);
	store.set(projectsAtom, [
		{ cwd: "/w/alpha", name: "alpha", sessionCount: 0, type: "normal" },
		{ cwd: "/w/alpine", name: "alpine", sessionCount: 0, type: "normal" },
	]);
});

it("keeps the selection anchored to the id when async session results arrive", async () => {
	const { result, rerender } = render();
	act(() => result.current.onQueryChange("alp"));
	await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0));

	press("arrowdown");
	const anchored = result.current.selectedId;
	expect(anchored).toBe("project:/w/alpine");

	// 会话结果晚到并被插进列表：选中项必须还是同一条，而不是被顶走。
	sessionSearchState.results = [sessionResult("/w/a.jsonl", "alp session")];
	rerender();
	await waitFor(() => expect(result.current.groups.some((group) => group.key === "sessions")).toBe(true));
	expect(result.current.selectedId).toBe(anchored);
});

it("falls back to the first row only when the anchored id disappears", async () => {
	const { result } = render();
	act(() => result.current.onQueryChange("alp"));
	press("arrowdown");
	expect(result.current.selectedId).toBe("project:/w/alpine");

	act(() => result.current.onQueryChange("alpha"));
	await waitFor(() => expect(result.current.selectedId).toBe("project:/w/alpha"));
});

it("suppresses the marker animation on typing but not on arrow navigation", async () => {
	const { result } = render();
	act(() => result.current.onQueryChange("alp"));
	expect(result.current.suppressSelectionAnimation).toBe(true);

	press("arrowdown");
	expect(result.current.suppressSelectionAnimation).toBe(false);

	act(() => result.current.onQueryChange("alph"));
	expect(result.current.suppressSelectionAnimation).toBe(true);
});

it("wraps around at both ends of the flattened row order", () => {
	const { result } = render();
	act(() => result.current.onQueryChange("alp"));

	press("arrowup");
	const last = result.current.selectedId;
	press("arrowdown");
	expect(result.current.selectedId).not.toBe(last);
});

it("opens a project on its latest session rather than the project overview", async () => {
	const onOpenSession = vi.fn(async () => undefined);
	projectSessions.current = [
		{
			id: "old",
			path: "/w/alpha/old.jsonl",
			cwd: "/w/alpha",
			firstMessage: "",
			modifiedAt: 1,
			access: { readHistory: true, resume: true, rename: true, delete: true },
		},
		{
			id: "latest",
			path: "/w/alpha/latest.jsonl",
			cwd: "/w/alpha",
			firstMessage: "",
			modifiedAt: 9,
			access: { readHistory: true, resume: true, rename: true, delete: true },
		},
	];
	const { result } = renderHook(() => useCommandMenuModel({ onOpenSession }));
	act(() => result.current.onQueryChange("alpha"));
	await waitFor(() => expect(result.current.selectedId).toBe("project:/w/alpha"));

	press("enter");
	// 面板立即关闭，不等异步的 listSessions 回来。
	expect(store.get(commandMenuOpenAtom)).toBe(false);
	await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith("/w/alpha", "/w/alpha/latest.jsonl"));
	expect(navigate).not.toHaveBeenCalled();
});

it("falls back to the project page when it has no openable session", async () => {
	const onOpenSession = vi.fn(async () => undefined);
	projectSessions.current = [];
	const { result } = renderHook(() => useCommandMenuModel({ onOpenSession }));
	act(() => result.current.onQueryChange("alpha"));
	await waitFor(() => expect(result.current.selectedId).toBe("project:/w/alpha"));

	press("enter");
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$cwd",
			params: { cwd: encodeURIComponent("/w/alpha") },
		}),
	);
	expect(onOpenSession).not.toHaveBeenCalled();
});

it("closes on escape and on a second mod+k without navigating", () => {
	const { result } = render();
	act(() => result.current.onQueryChange("alpha"));

	press("mod+k");
	expect(store.get(commandMenuOpenAtom)).toBe(false);
	expect(navigate).not.toHaveBeenCalled();

	store.set(commandMenuOpenAtom, true);
	press("escape");
	expect(store.get(commandMenuOpenAtom)).toBe(false);
});

it("clears the query when closed so the next open starts empty", async () => {
	const { result } = render();
	act(() => result.current.onQueryChange("alpha"));
	expect(result.current.query).toBe("alpha");

	act(() => result.current.onClose());
	expect(result.current.query).toBe("");
});

it("shows no groups and issues no session search while the query is empty", () => {
	const { result } = render();
	// 空查询态：不发 IPC，只有本地目录，且逃生行不出现。
	expect(result.current.groups.some((group) => group.key === "sessions")).toBe(false);
	expect(
		result.current.groups
			.flatMap((group) => group.items)
			.some((item) => item.id === "ability:marketplace-search"),
	).toBe(false);
});

it("keeps an unavailable session out of keyboard navigation", async () => {
	sessionSearchState.results = [
		{
			...sessionResult("/w/locked.jsonl", "alp locked"),
			session: {
				...sessionResult("/w/locked.jsonl", "alp locked").session,
				access: { readHistory: false, resume: false, rename: false, delete: false },
			},
		},
	];
	const { result } = render();
	act(() => result.current.onQueryChange("alp locked"));

	await waitFor(() => expect(result.current.groups.some((group) => group.key === "sessions")).toBe(true));
	const sessions = result.current.groups.find((group) => group.key === "sessions");
	expect(sessions?.items[0].disabled).toBe(true);
	// 禁用行不参与导航，回车不应打开它。
	act(() => result.current.onActivateItem("session:/w/locked.jsonl"));
	expect(navigate).not.toHaveBeenCalled();
});
