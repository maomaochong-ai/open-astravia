import { createLsToolRegistration } from "../../../src/coding/index.js";
import type { LsBehaviorSubject, LsBehaviorSubjectOptions } from "./ls-behavior-contract.js";
import { defineLsBehaviorContract } from "./ls-behavior-contract.js";

function createRuntimeSubject(cwd: string, options?: LsBehaviorSubjectOptions): LsBehaviorSubject {
	const registration = createLsToolRegistration(cwd, options);
	return {
		definition: {
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
			scopeUse: registration.scopeUse,
			category: registration.category,
		},
		execute(input, signal = new AbortController().signal) {
			return registration.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-ls-contract",
				input,
				signal,
			});
		},
	};
}

defineLsBehaviorContract("runtime", createRuntimeSubject);
