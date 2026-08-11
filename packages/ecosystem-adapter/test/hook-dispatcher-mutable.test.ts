import { describe, expect, it, vi } from "vitest";
import { HookDispatcher } from "../src/hooks/dispatcher.js";
import { EcosystemHookRuntime } from "../src/hooks/runtime.js";
import type {
	ConfiguredHookHandler,
	HookCommandExecutionRequest,
	HookCommandExecutor,
	HookCommandResult,
	HookCompatibilityProfile,
	HookDispatchEffect,
	HookHandlerOutcome,
	HookRequest,
} from "../src/hooks/types.js";

describe("mutable HookDispatcher", () => {
	it("registers and releases handler contributions at runtime", async () => {
		const executor = new RecordingExecutor();
		const dispatcher = createDispatcher(executor);

		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
		const lease = dispatcher.registerContribution({
			id: "skill:review",
			revision: "v1",
			handlers: [handler("review-v1")],
		});

		expect((await dispatcher.dispatch(request())).runs).toHaveLength(1);
		expect(executor.commands).toEqual(["review-v1"]);

		lease.release();
		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
	});

	it("atomically replaces a contribution without allowing a stale lease to remove it", async () => {
		const executor = new RecordingExecutor();
		const dispatcher = createDispatcher(executor);
		const staleLease = dispatcher.registerContribution({
			id: "skill:review",
			revision: "v1",
			handlers: [handler("review-v1")],
		});
		const currentLease = dispatcher.registerContribution({
			id: "skill:review",
			revision: "v2",
			handlers: [handler("review-v2")],
		});

		staleLease.release();
		await dispatcher.dispatch(request());
		expect(executor.commands).toEqual(["review-v2"]);

		currentLease.release();
		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
	});

	it("keeps an in-flight dispatch stable when its contribution is released", async () => {
		let complete: ((result: HookCommandResult) => void) | undefined;
		const executor: HookCommandExecutor = {
			execute: vi.fn(
				() =>
					new Promise<HookCommandResult>((resolve) => {
						complete = resolve;
					}),
			),
		};
		const dispatcher = createDispatcher(executor);
		const lease = dispatcher.registerContribution({
			id: "skill:review",
			revision: "v1",
			handlers: [handler("review-v1")],
		});

		const running = dispatcher.dispatch(request());
		await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(1));
		lease.release();
		complete?.(commandResult());

		expect((await running).runs).toHaveLength(1);
		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
	});

	it("claims once handlers for the session even after contribution re-registration", async () => {
		const executor = new RecordingExecutor();
		const dispatcher = createDispatcher(executor);
		const contribution = {
			id: "skill:review",
			revision: "v1",
			handlers: [handler("review-once", true)],
		};
		const firstLease = dispatcher.registerContribution(contribution);

		await Promise.all([dispatcher.dispatch(request()), dispatcher.dispatch(request())]);
		expect(executor.commands).toEqual(["review-once"]);

		firstLease.release();
		dispatcher.registerContribution(contribution);
		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
	});

	it("keeps current-turn contributions when another prompt is queued", async () => {
		const executor = new RecordingExecutor();
		const dispatcher = createDispatcher(executor);
		const runtime = new EcosystemHookRuntime({
			host: {
				cwd: "C:/workspace",
				getSessionId: () => "session-1",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun() {},
			},
			initialSessionStartSource: "startup",
			loadAdapters: async () => [
				{
					id: "test-hooks/v1",
					supports: (event) => event.eventName === "PreToolUse",
					dispatch: (_event, signal) => dispatcher.dispatch(request(), signal),
					registerContribution: async (source) =>
						dispatcher.registerContribution({
							id: source.id,
							revision: source.revision,
							handlers: [handler("review-v1")],
						}),
				},
			],
		});

		await runtime.runUserPromptSubmit("current", undefined, [
			{
				id: "skill:review",
				revision: "v1",
				profileId: "test-hooks/v1",
				sourcePath: "C:/skills/review/SKILL.md",
				configuration: {},
			},
		]);
		await runtime.runUserPromptSubmit("queued");
		await runtime.runPreToolUse("tool-1", "bash", {});

		expect(executor.commands).toEqual(["review-v1"]);
		runtime.finishCurrentTurn();
		expect((await dispatcher.dispatch(request())).runs).toHaveLength(0);
	});
});

class RecordingExecutor implements HookCommandExecutor {
	readonly commands: string[] = [];

	async execute(input: HookCommandExecutionRequest): Promise<HookCommandResult> {
		this.commands.push(input.command);
		return commandResult();
	}
}

function createDispatcher(executor: HookCommandExecutor): HookDispatcher {
	return new HookDispatcher({
		profile,
		handlers: [],
		executor,
	});
}

function handler(command: string, once = false): ConfiguredHookHandler {
	return {
		eventName: "PreToolUse",
		command,
		timeoutMs: 1_000,
		sourcePath: "C:/skills/review/SKILL.md",
		displayOrder: 0,
		once,
	};
}

function request(): HookRequest {
	return {
		eventName: "PreToolUse",
		sessionId: "session-1",
		turnId: "turn-1",
		cwd: "C:/workspace",
		transcriptPath: null,
		model: "test-model",
		permissionMode: "default",
		tool: { name: "Bash", matcherAliases: ["Bash"] },
		toolUseId: crypto.randomUUID(),
		toolInput: {},
	};
}

function commandResult(): HookCommandResult {
	return {
		startedAt: 1,
		completedAt: 1,
		durationMs: 0,
		exitCode: 0,
		stdout: "",
		stderr: "",
	};
}

const profile: HookCompatibilityProfile = {
	id: "test-hooks/v1",
	encodeInput: () => "{}",
	interpretResult: (): HookHandlerOutcome => ({
		status: "Completed",
		entries: [],
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		feedbackMessages: [],
		continuationFragments: [],
	}),
	aggregate: (_request, outcomes): HookDispatchEffect => ({
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: outcomes.flatMap((outcome) => outcome.additionalContexts),
		continuationFragments: [],
	}),
	matches: () => true,
};
