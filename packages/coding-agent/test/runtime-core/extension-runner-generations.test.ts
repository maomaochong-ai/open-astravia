import { describe, expect, it } from "vitest";
import { ExtensionRunnerGenerationOwner } from "../../src/extensions/runtime/extension-runner-generations.js";
import type { CodingAgentExtensionRunnerPort } from "../../src/runtime-contracts/index.js";

describe("ExtensionRunnerGenerationOwner", () => {
	it("routes an admitted Turn to its retired Runner until every lease releases", async () => {
		const owner = new ExtensionRunnerGenerationOwner();
		const firstRunner = runner("first");
		const secondRunner = runner("second");
		const unbindFirstEvents = owner.bind("session-1", firstRunner);
		const unbindFirstTools = owner.bind("session-1", firstRunner);
		const firstPromptLease = owner.acquire("session-1", "turn-1");
		const firstToolLease = owner.acquire("session-1", "turn-1");

		const unbindSecondEvents = owner.bind("session-1", secondRunner, { replaceExisting: true });
		const unbindSecondTools = owner.bind("session-1", secondRunner);
		const secondLease = owner.acquire("session-1", "turn-2");

		expect(firstPromptLease?.runner).toBe(firstRunner);
		expect(owner.ownsTurn("session-1", "turn-1", firstRunner)).toBe(true);
		expect(owner.ownsTurn("session-1", "turn-1", secondRunner)).toBe(false);
		expect(owner.ownsTurn("session-1", "turn-2", secondRunner)).toBe(true);

		let firstDisposed = false;
		const disposeFirst = Promise.all([unbindFirstEvents(), unbindFirstTools()]).then(() => {
			firstDisposed = true;
		});
		await Promise.resolve();
		expect(firstDisposed).toBe(false);

		firstPromptLease?.release();
		expect(owner.ownsTurn("session-1", "turn-1", firstRunner)).toBe(true);
		firstToolLease?.release();
		await disposeFirst;
		expect(owner.ownsTurn("session-1", "turn-1", firstRunner)).toBe(false);

		secondLease?.release();
		await Promise.all([unbindSecondEvents(), unbindSecondTools()]);
	});
});

function runner(id: string): CodingAgentExtensionRunnerPort {
	return { id } as unknown as CodingAgentExtensionRunnerPort;
}
