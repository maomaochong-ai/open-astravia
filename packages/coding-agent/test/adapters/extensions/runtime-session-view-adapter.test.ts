import type { RuntimeSessionCoreAssembly } from "@vetta/runtime-core";
import { createEmptyConversationDocument } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { createCodingAgentExtensionSessionView } from "../../../src/adapters/extensions/runtime-session-view-adapter.js";

describe("createCodingAgentExtensionSessionView", () => {
	it("projects the host-owned session directory without parsing the session path", () => {
		const view = createCodingAgentExtensionSessionView(
			createAssembly({
				sessionDirectory: "virtual://session-artifacts",
				sessionPath: "opaque-session-location",
			}),
		);

		expect(view.getSessionDir()).toBe("virtual://session-artifacts");
		expect(view.getSessionFile()).toBe("opaque-session-location");
	});

	it("falls back to the working directory for non-persistent sessions", () => {
		const view = createCodingAgentExtensionSessionView(createAssembly({}));

		expect(view.getSessionDir()).toBe("C:\\workspace");
		expect(view.getSessionFile()).toBeUndefined();
	});
});

function createAssembly(location: {
	readonly sessionDirectory?: string;
	readonly sessionPath?: string;
}): RuntimeSessionCoreAssembly {
	const document = createEmptyConversationDocument({
		sessionId: "session-1",
		createdAt: 1,
		cwd: "C:\\document-workspace",
	});
	return {
		lifecycle: {
			sessionId: "session-1",
			sessionDirectory: location.sessionDirectory,
			sessionPath: location.sessionPath,
			dispose: async () => {},
		},
		conversationView: { readDocument: () => document },
		workspaceView: { readWorkingDirectory: () => "C:\\workspace" },
	} as unknown as RuntimeSessionCoreAssembly;
}
