import { describe, expect, it } from "vitest";
import {
	ENGINE_RESTART_LIMIT,
	ENGINE_RESTART_WINDOW_MS,
	planEngineRestart,
} from "../src/engine/engine-recovery";

describe("design engine restart policy", () => {
	it("restarts unexpected exits with bounded exponential backoff", () => {
		let history: readonly number[] = [];
		for (let attempt = 1; attempt <= ENGINE_RESTART_LIMIT; attempt += 1) {
			const decision = planEngineRestart(history, attempt * 1_000);
			expect(decision.kind).toBe("restart");
			if (decision.kind !== "restart") throw new Error("expected restart");
			expect(decision.attempt).toBe(attempt);
			expect(decision.delayMs).toBe(250 * 2 ** (attempt - 1));
			history = decision.history;
		}

		const exhausted = planEngineRestart(history, 4_000);
		expect(exhausted).toMatchObject({ kind: "exhausted", attempts: ENGINE_RESTART_LIMIT + 1 });
	});

	it("forgets old crashes after the stability window", () => {
		const oldHistory = [1_000, 2_000, 3_000];
		const decision = planEngineRestart(oldHistory, 3_000 + ENGINE_RESTART_WINDOW_MS + 1);
		expect(decision).toMatchObject({ kind: "restart", attempt: 1, history: [3_000 + ENGINE_RESTART_WINDOW_MS + 1] });
	});
});
