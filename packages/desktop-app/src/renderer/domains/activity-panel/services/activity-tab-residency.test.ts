import type { ActivityTabKey } from "@shared/lib/project-profile";
import { describe, expect, it } from "vitest";
import type { ActivityTabDefinition, ActivityTabRetention, ResolvedActivityTab } from "../registry/types";
import {
	type ActivityTabResidencyInput,
	activityTabRetention,
	createActivityTabResidencyState,
	evictWarmActivityTabs,
	reconcileActivityTabResidency,
	resolveResidentActivityTabs,
	resolveWarmTabEvictions,
} from "./activity-tab-residency";

function tab(id: string, options: { keepAlive?: boolean; retention?: ActivityTabRetention } = {}): ResolvedActivityTab {
	const definition: ActivityTabDefinition = {
		id,
		source: "builtin",
		useMeta: () => ({ label: id }),
		component: () => null,
		keepAliveWhenAvailable: options.keepAlive,
		retention: options.retention,
	};
	return {
		id,
		label: id,
		removable: true,
		source: "builtin",
		definition,
	};
}

function input(
	candidates: readonly ResolvedActivityTab[],
	activeTab: ActivityTabKey,
	options: {
		floatingKeys?: ReadonlySet<ActivityTabKey>;
		scopeKey?: string | null;
		warmEligibleTabs?: readonly ResolvedActivityTab[];
	} = {},
): ActivityTabResidencyInput {
	return {
		activeTab,
		candidates,
		floatingKeys: options.floatingKeys ?? new Set(),
		scopeKey: options.scopeKey ?? "C:/repo",
		warmEligibleTabs: options.warmEligibleTabs ?? candidates,
	};
}

describe("activity tab residency", () => {
	it("defaults to warm while preserving legacy keep-alive semantics", () => {
		expect(activityTabRetention(tab("default"))).toBe("warm");
		expect(activityTabRetention(tab("kept", { keepAlive: true }))).toBe("pinned");
		expect(activityTabRetention(tab("ephemeral", { keepAlive: false }))).toBe("active-only");
		expect(activityTabRetention(tab("explicit", { keepAlive: true, retention: "warm" }))).toBe("warm");
	});

	it("keeps visited warm tabs resident and updates their LRU order", () => {
		const candidates = [tab("file"), tab("content"), tab("todo")];
		let state = reconcileActivityTabResidency(createActivityTabResidencyState("C:/repo"), input(candidates, "file"));
		state = reconcileActivityTabResidency(state, input(candidates, "content"));
		expect(state.warmLru).toEqual(["file", "content"]);
		expect(resolveResidentActivityTabs(state, input(candidates, "content")).map((item) => item.id)).toEqual([
			"file",
			"content",
		]);

		state = reconcileActivityTabResidency(state, input(candidates, "file"));
		expect(state.warmLru).toEqual(["content", "file"]);
	});

	it("evicts the oldest inactive warm tab while protecting active and floating tabs", () => {
		const candidates = [tab("one"), tab("two"), tab("three"), tab("four")];
		let state = createActivityTabResidencyState("C:/repo");
		for (const active of ["one", "two", "three", "four"] as ActivityTabKey[]) {
			state = reconcileActivityTabResidency(state, input(candidates, active));
		}
		const currentInput = input(candidates, "four", {
			floatingKeys: new Set<ActivityTabKey>(["one"]),
		});
		const evictions = resolveWarmTabEvictions(state, currentInput, 1);
		expect(evictions).toEqual(["two"]);
		expect(evictWarmActivityTabs(state, evictions).warmLru).toEqual(["one", "three", "four"]);
	});

	it("mounts pinned tabs eagerly and active-only tabs only while active or floating", () => {
		const candidates = [
			tab("file"),
			tab("browser", { retention: "pinned" }),
			tab("cheap", { retention: "active-only" }),
		];
		const state = reconcileActivityTabResidency(
			createActivityTabResidencyState("C:/repo"),
			input(candidates, "file"),
		);
		expect(resolveResidentActivityTabs(state, input(candidates, "file")).map((item) => item.id)).toEqual([
			"file",
			"browser",
		]);
		expect(
			resolveResidentActivityTabs(
				state,
				input(candidates, "file", { floatingKeys: new Set<ActivityTabKey>(["cheap"]) }),
			).map((item) => item.id),
		).toEqual(["file", "browser", "cheap"]);
	});

	it("drops detached tabs and resets warm history when the project scope changes", () => {
		const candidates = [tab("file"), tab("content")];
		let state = reconcileActivityTabResidency(
			createActivityTabResidencyState("C:/one"),
			input(candidates, "file", { scopeKey: "C:/one" }),
		);
		state = reconcileActivityTabResidency(
			state,
			input(candidates, "content", { scopeKey: "C:/one", warmEligibleTabs: [candidates[1]] }),
		);
		expect(state.warmLru).toEqual(["content"]);

		state = reconcileActivityTabResidency(state, input(candidates, "file", { scopeKey: "C:/two" }));
		expect(state).toEqual({ scopeKey: "C:/two", warmLru: ["file"] });
	});
});
