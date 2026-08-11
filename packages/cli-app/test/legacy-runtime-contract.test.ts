import { describe, expect, it } from "vitest";
import { legacyRuntimeContract } from "./support/legacy-runtime-contract.js";

describe("frozen Legacy runtime observation contract", () => {
	it("loads the immutable versioned contract through runtime validation", () => {
		expect(legacyRuntimeContract.schemaVersion).toBe(1);
		expect(legacyRuntimeContract.print.coreEventTypes.at(0)).toBe("agent_start");
		expect(legacyRuntimeContract.rpc.streamingLifecycle.at(-1)).toBe("agent_end");
	});
});
