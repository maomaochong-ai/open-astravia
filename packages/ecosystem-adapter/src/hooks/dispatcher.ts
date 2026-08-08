import type {
	ConfiguredHookHandler,
	HookCommandExecutor,
	HookCompatibilityProfile,
	HookContributionLease,
	HookDispatchEffect,
	HookDispatchOutcome,
	HookHandlerContribution,
	HookHandlerOutcome,
	HookObserver,
	HookRequest,
	HookRunSummary,
} from "./types.js";

export interface HookDispatcherOptions {
	profile: HookCompatibilityProfile;
	handlers: readonly ConfiguredHookHandler[];
	executor: HookCommandExecutor;
	observer?: HookObserver;
}

export class HookDispatcher {
	private readonly profile: HookCompatibilityProfile;
	private readonly contributions = new Map<string, RegisteredContribution>();
	private readonly onceClaims = new Set<string>();
	private readonly executor: HookCommandExecutor;
	private readonly observer?: HookObserver;

	constructor(options: HookDispatcherOptions) {
		this.profile = options.profile;
		this.executor = options.executor;
		this.observer = options.observer;
		this.setContribution({ id: "__static__", revision: "initial", handlers: options.handlers });
	}

	registerContribution(contribution: HookHandlerContribution): HookContributionLease {
		const generation = this.setContribution(contribution);
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				if (this.contributions.get(contribution.id)?.generation === generation) {
					this.contributions.delete(contribution.id);
				}
			},
		};
	}

	resetSessionState(): void {
		this.onceClaims.clear();
	}

	hasHandlers(eventName: HookRequest["eventName"]): boolean {
		return this.snapshotHandlers().some(({ handler }) => handler.eventName === eventName);
	}

	async dispatch(request: HookRequest, signal?: AbortSignal): Promise<HookDispatchOutcome> {
		const handlers = this.selectHandlers(request);
		if (handlers.length === 0) {
			return { ...emptyEffect(), runs: [] };
		}

		let input: string;
		try {
			input = this.profile.encodeInput(request);
		} catch (error) {
			const now = epochSeconds();
			const message = error instanceof Error ? error.message : String(error);
			const outcomes = handlers.map<HookHandlerOutcome>(() => ({
				...emptyHandlerOutcome(),
				status: "Failed",
				entries: [{ kind: "Error", text: `failed to serialize hook input: ${message}` }],
			}));
			const runs = handlers.map(({ handler }, index) => {
				const run = this.completedSummary(handler, request, outcomes[index], {
					startedAt: now,
					completedAt: now,
					durationMs: 0,
				});
				this.notifyCompleted(run);
				return run;
			});
			const effect = this.profile.aggregate(request, outcomes);
			logHookDispatch(request, effect, runs);
			return { ...effect, runs };
		}

		for (const { handler } of handlers) {
			this.notifyStarted(this.runningSummary(handler, request));
		}

		let completionOrder = 0;
		const results = await Promise.all(
			handlers.map(async ({ handler }) => {
				const result = await this.executor.execute(
					{
						command: handler.command,
						cwd: request.cwd,
						stdin: input,
						timeoutMs: handler.timeoutMs,
						env: handler.env,
					},
					signal,
				);
				return { ...result, completionOrder: completionOrder++ };
			}),
		);
		const outcomes = results.map((result) => this.profile.interpretResult(request, result));
		const runs = handlers.map(({ handler }, index) => {
			const result = results[index];
			const run = this.completedSummary(handler, request, outcomes[index], result);
			this.notifyCompleted(run);
			return run;
		});

		const effect = this.profile.aggregate(request, outcomes);
		logHookDispatch(request, effect, runs);
		return { ...effect, runs };
	}

	private selectHandlers(request: HookRequest): RegisteredHandler[] {
		return this.snapshotHandlers()
			.filter(({ handler }) => handler.eventName === request.eventName)
			.filter(({ handler }) => this.profile.matches(request, handler.matcher))
			.filter((entry) => this.claimOnce(entry));
	}

	private setContribution(contribution: HookHandlerContribution): symbol {
		const generation = Symbol(contribution.id);
		this.contributions.set(contribution.id, {
			generation,
			revision: contribution.revision,
			handlers: [...contribution.handlers],
		});
		return generation;
	}

	private snapshotHandlers(): RegisteredHandler[] {
		return [...this.contributions].flatMap(([contributionId, contribution]) =>
			contribution.handlers.map((handler, handlerIndex) => ({
				contributionId,
				revision: contribution.revision,
				handlerIndex,
				handler,
			})),
		);
	}

	private claimOnce(entry: RegisteredHandler): boolean {
		if (entry.handler.once !== true) return true;
		const key = `${entry.contributionId}\0${entry.revision}\0${entry.handlerIndex}`;
		if (this.onceClaims.has(key)) return false;
		this.onceClaims.add(key);
		return true;
	}

	private runningSummary(handler: ConfiguredHookHandler, request: HookRequest): HookRunSummary {
		return {
			id: runId(handler, request),
			profileId: this.profile.id,
			eventName: handler.eventName,
			handlerType: "command",
			executionMode: "sync",
			scope: sessionScopedEvent(handler.eventName) ? "session" : "turn",
			sourcePath: handler.sourcePath,
			displayOrder: handler.displayOrder,
			status: "Running",
			statusMessage: handler.statusMessage,
			startedAt: epochSeconds(),
			entries: [],
		};
	}

	private completedSummary(
		handler: ConfiguredHookHandler,
		request: HookRequest,
		outcome: HookHandlerOutcome,
		timing: { startedAt: number; completedAt: number; durationMs: number },
	): HookRunSummary {
		return {
			id: runId(handler, request),
			profileId: this.profile.id,
			eventName: handler.eventName,
			handlerType: "command",
			executionMode: "sync",
			scope: sessionScopedEvent(handler.eventName) ? "session" : "turn",
			sourcePath: handler.sourcePath,
			displayOrder: handler.displayOrder,
			status: outcome.status,
			statusMessage: handler.statusMessage,
			startedAt: timing.startedAt,
			completedAt: timing.completedAt,
			durationMs: timing.durationMs,
			entries: outcome.entries,
		};
	}

	private notifyStarted(summary: HookRunSummary): void {
		try {
			this.observer?.onRunStarted?.(summary);
		} catch {
			// Observability must not change hook behavior.
		}
	}

	private notifyCompleted(summary: HookRunSummary): void {
		try {
			this.observer?.onRunCompleted?.(summary);
		} catch {
			// Observability must not change hook behavior.
		}
	}
}

interface RegisteredContribution {
	readonly generation: symbol;
	readonly revision: string;
	readonly handlers: readonly ConfiguredHookHandler[];
}

interface RegisteredHandler {
	readonly contributionId: string;
	readonly revision: string;
	readonly handlerIndex: number;
	readonly handler: ConfiguredHookHandler;
}

export function emptyEffect() {
	return {
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
	};
}

export function emptyHandlerOutcome(): HookHandlerOutcome {
	return {
		status: "Completed",
		entries: [],
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		feedbackMessages: [],
		continuationFragments: [],
	};
}

function runId(handler: ConfiguredHookHandler, request: HookRequest): string {
	const event = handler.eventName.replace(
		/[A-Z]/g,
		(letter, index) => `${index === 0 ? "" : "-"}${letter.toLowerCase()}`,
	);
	const base = `${event}:${handler.displayOrder}:${handler.sourcePath}`;
	if (
		request.eventName === "PreToolUse" ||
		request.eventName === "PostToolUse" ||
		request.eventName === "PostToolUseFailure"
	) {
		return `${base}:${request.toolUseId}`;
	}
	if (request.eventName === "PermissionRequest") return `${base}:${request.runIdSuffix}`;
	return base;
}

function sessionScopedEvent(eventName: HookRequest["eventName"]): boolean {
	return eventName === "SessionStart" || eventName === "SessionEnd";
}

function epochSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** 只记关键结果：生命周期事件或 block/fail；不含 command/stdin/payload。 */
function logHookDispatch(request: HookRequest, effect: HookDispatchEffect, runs: readonly HookRunSummary[]): void {
	const hasIssue =
		effect.shouldBlock ||
		effect.shouldStop ||
		runs.some((run) => run.status === "Failed" || run.status === "Blocked" || run.status === "Stopped");
	const alwaysLog =
		request.eventName === "SessionStart" ||
		request.eventName === "SessionEnd" ||
		request.eventName === "Stop" ||
		request.eventName === "PreCompact" ||
		request.eventName === "PostCompact";
	if (!alwaysLog && !hasIssue) return;

	const tool =
		request.eventName === "PreToolUse" ||
		request.eventName === "PostToolUse" ||
		request.eventName === "PostToolUseFailure" ||
		request.eventName === "PermissionRequest"
			? request.tool.name
			: undefined;

	console.info("[ecosystem-hooks] dispatch", {
		event: request.eventName,
		cwd: request.cwd,
		tool,
		handlers: runs.length,
		statuses: runs.map((run) => run.status),
		shouldBlock: effect.shouldBlock || undefined,
		shouldStop: effect.shouldStop || undefined,
		reason: effect.blockReason ?? effect.stopReason,
		contexts: effect.additionalContexts.length || undefined,
	});
}
