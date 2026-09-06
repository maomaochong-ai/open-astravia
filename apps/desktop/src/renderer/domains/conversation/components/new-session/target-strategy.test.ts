import { describe, expect, it, vi } from "vitest";
import { teamTargetKey } from "./target";
import { createNewSessionTargetStrategyRegistry } from "./target-strategy";

describe("new-session target strategy registry", () => {
	it("resolves ordinary by default and team only when selected", async () => {
		const conversation = vi.fn(async () => undefined);
		const team = vi.fn(async () => undefined);
		const registry = createNewSessionTargetStrategyRegistry({
			conversationDispatch: conversation,
			teamDispatch: team,
			teamKey: teamTargetKey("team-1"),
		});
		await registry.resolve(null).dispatch();
		await registry.resolve(teamTargetKey("team-1")).dispatch();
		await expect(registry.resolve(teamTargetKey("missing")).dispatch()).rejects.toThrow("Unknown new-session target");
		expect(conversation).toHaveBeenCalledOnce();
		expect(team).toHaveBeenCalledOnce();
	});
});
