import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSubagentRuntime } from "../../src/composition/subagent/runtime.js";
import {
	CODING_AGENT_SUBAGENT_RUNTIME_OWNER,
	createCodingAgentSubagentSessionExtension,
} from "../../src/composition/subagent/subagent-session-extension.js";

describe("Coding Agent Subagent Session Extension", () => {
	it("owns feature/document delegation and disposes the attached runtime exactly once", async () => {
		const prepare = vi.fn(async () => ({ contribute: async () => ({}), dispose: async () => {} }));
		const initialize = vi.fn(async () => {});
		const onDocumentChanged = vi.fn(async () => {});
		const onSessionEvent = vi.fn(async () => {});
		const dispose = vi.fn(async () => {});
		const runtime = {
			feature: { id: "coding-agent-subagents", prepare },
			initialize,
			onDocumentChanged,
			onSessionEvent,
			dispose,
		} as unknown as CodingAgentSubagentRuntime;
		const composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentSubagentSessionExtension()],
		});
		composition.services.require(CODING_AGENT_SUBAGENT_RUNTIME_OWNER).attach(runtime);

		await composition.features[0]!.prepare({} as never);
		await composition.documentParticipants[0]!.initialize({} as never, {} as never);
		await composition.documentParticipants[0]!.onDocumentChanged({} as never);
		await composition.documentParticipants[0]!.onSessionEvent?.({} as never);

		expect(prepare).toHaveBeenCalledOnce();
		expect(initialize).toHaveBeenCalledOnce();
		expect(onDocumentChanged).toHaveBeenCalledOnce();
		expect(onSessionEvent).toHaveBeenCalledOnce();

		await composition.dispose();
		await composition.dispose();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("fails closed when contributions are used before the runtime is attached", async () => {
		const composition = await SessionExtensionComposition.create({
			definitions: [createCodingAgentSubagentSessionExtension()],
		});

		expect(() => composition.features[0]!.prepare({} as never)).toThrow(
			"Coding Agent Subagent runtime has not been attached",
		);
		await composition.dispose();
	});
});
