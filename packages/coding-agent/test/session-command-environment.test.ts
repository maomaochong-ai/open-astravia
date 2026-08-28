import { describe, expect, it } from "vitest";
import {
	CODING_AGENT_SESSION_ID_ENV,
	createCodingAgentSessionCommandEnvironment,
} from "../src/composition/session-command-environment.js";

describe("createCodingAgentSessionCommandEnvironment", () => {
	it("injects the host-owned session id without dropping caller environment", () => {
		expect(createCodingAgentSessionCommandEnvironment("session-123", { KEEP: "value" })).toEqual({
			KEEP: "value",
			[CODING_AGENT_SESSION_ID_ENV]: "session-123",
		});
	});

	it("does not allow caller environment to replace the session identity", () => {
		expect(
			createCodingAgentSessionCommandEnvironment("canonical-session", {
				[CODING_AGENT_SESSION_ID_ENV]: "spoofed-session",
			}),
		).toMatchObject({ [CODING_AGENT_SESSION_ID_ENV]: "canonical-session" });
	});

	it("rejects an empty session identity", () => {
		expect(() => createCodingAgentSessionCommandEnvironment(" ")).toThrow("requires a session id");
	});
});
