// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTeamMemberModels } from "./useTeamMemberModels";
import type { TeamMemberModelPreference } from "../../../shared/agent-team-member-model";

type Preferences = Readonly<Record<string, TeamMemberModelPreference>>;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
const pinned: Preferences = { member: { agentProfileId: "agent", modelKey: "p/fixed" } };
const list = vi.fn<() => Promise<Preferences>>();
const save = vi.fn<() => Promise<Preferences>>();
let changed: Set<(teamId: string) => void>;

beforeEach(() => {
	list.mockReset().mockResolvedValue({});
	save.mockReset().mockResolvedValue(pinned);
	changed = new Set();
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			agentTeams: {
				listMemberModels: list,
				setMemberModel: save,
				onChanged: () => () => undefined,
				onMemberModelsChanged: (listener: (teamId: string) => void) => {
					changed.add(listener);
					return () => changed.delete(listener);
				},
			},
		},
	});
});

function wrapper() {
	const store = createStore();
	return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

it("shares saved settings across entrances and ignores a stale read completed after an edit", async () => {
	const stale = deferred<Preferences>();
	list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({});
	const { result, unmount } = renderHook(
		() => ({ settings: useTeamMemberModels("team"), chat: useTeamMemberModels("team") }),
		{ wrapper: wrapper() },
	);
	await waitFor(() => expect(result.current.chat.state?.models).toEqual({}));
	await act(() => result.current.settings.select("member", { modelKey: "p/fixed" }));
	expect(result.current.chat.state?.models).toEqual(pinned);
	await act(async () => {
		stale.resolve({});
		await stale.promise;
	});
	expect(result.current.settings.state?.models).toEqual(pinned);
	expect(result.current.chat.state?.models).toEqual(pinned);
	unmount();
	expect(changed.size).toBe(0);
});

it("reloads an external change received while a save is pending", async () => {
	const pending = deferred<Preferences>();
	save.mockReturnValueOnce(pending.promise);
	const { result } = renderHook(() => useTeamMemberModels("team"), { wrapper: wrapper() });
	await waitFor(() => expect(result.current.state?.models).toEqual({}));
	const loaded = list.mock.calls.length;
	act(() => { for (const listener of changed) listener("other-team"); });
	expect(list.mock.calls.length).toBe(loaded);
	let saving!: Promise<void>;
	act(() => {
		saving = result.current.select("member", { modelKey: "p/fixed" });
	});
	expect(result.current.state?.saving).toBe(true);
	const external = { ...pinned, other: { agentProfileId: "other", modelKey: "p/other" } };
	list.mockResolvedValue(external);
	act(() => {
		for (const listener of changed) listener("team");
	});
	await act(async () => {
		pending.resolve(pinned);
		await saving;
	});
	expect(result.current.state?.models).toEqual(external);
	expect(result.current.state?.saving).toBe(false);
});

it("keeps a late response from a previous team out of the new team's settings", async () => {
	const old = deferred<Preferences>();
	list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({});
	const { result, rerender } = renderHook(({ teamId }) => useTeamMemberModels(teamId), {
		initialProps: { teamId: "old" },
		wrapper: wrapper(),
	});
	rerender({ teamId: "new" });
	await waitFor(() => expect(result.current.state?.models).toEqual({}));
	await act(async () => {
		old.resolve(pinned);
		await old.promise;
	});
	expect(result.current.state?.models).toEqual({});
});
