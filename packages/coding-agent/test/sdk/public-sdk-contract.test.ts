import { describe, expect, it } from "vitest";
import { runRpcModeWithCapabilities } from "../../src/public-api/rpc.js";
import {
	type CreateCodingAgentSessionOptions,
	type CreateCodingAgentSessionResult,
	createCodingAgentSession,
} from "../../src/public-api/sdk.js";

describe("public SDK contract", () => {
	it("exposes only stable Session and capability-oriented RPC factories", () => {
		const factory: (options?: CreateCodingAgentSessionOptions) => Promise<CreateCodingAgentSessionResult> =
			createCodingAgentSession;

		expect(factory).toBe(createCodingAgentSession);
		expect(runRpcModeWithCapabilities).toBeTypeOf("function");
	});
});
