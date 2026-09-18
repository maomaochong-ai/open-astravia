// @vitest-environment jsdom

import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTeamSidebarConversations } from "./useTeamSidebarConversations";

function stubSidebarConversations(list: () => Promise<unknown[]>): void {
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: { agentTeams: { listSidebarConversations: list } },
	});
}

describe("useTeamSidebarConversations", () => {
	it("keeps the loaded list on screen while team sessions refresh", async () => {
		let titles = ["first"];
		const list = vi.fn(async () => titles.map((title) => ({ id: title, title })));
		stubSidebarConversations(list);
		const loadingHistory: boolean[] = [];
		const { result } = renderHook(() => {
			const state = useTeamSidebarConversations(["/project"]);
			loadingHistory.push(state.loading);
			return state;
		});

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.conversations).toHaveLength(1);
		loadingHistory.length = 0;

		titles = ["first", "second"];
		act(() => notifyTeamSessionsChanged("team-1"));
		await waitFor(() => expect(result.current.conversations).toHaveLength(2));

		expect(list).toHaveBeenCalledTimes(2);
		expect(loadingHistory).not.toContain(true);
	});

	it("stops showing the loading state when the first load fails", async () => {
		stubSidebarConversations(vi.fn(async () => Promise.reject(new Error("ipc down"))));
		const { result } = renderHook(() => useTeamSidebarConversations(["/project"]));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.conversations).toEqual([]);
	});
});
