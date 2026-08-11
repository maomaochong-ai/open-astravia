import type {
	CodingAgentHost,
	CreateCodingAgentHostOptions,
	CreateCodingAgentSessionOptions,
	CreateCodingAgentSessionResult,
} from "../public-api/sdk/index.js";

export interface CodingAgentHostSessionLifecycle {
	readonly onClosed: () => void;
}

export type CodingAgentHostSessionFactory = (
	options: CreateCodingAgentSessionOptions,
	lifecycle: CodingAgentHostSessionLifecycle,
) => Promise<CreateCodingAgentSessionResult>;

export function createCodingAgentHostFromSessionFactory(
	options: CreateCodingAgentHostOptions,
	createSession: CodingAgentHostSessionFactory,
): CodingAgentHost {
	return new DefaultCodingAgentHost(options, createSession);
}

class DefaultCodingAgentHost implements CodingAgentHost {
	private readonly sessions = new Set<CreateCodingAgentSessionResult["session"]>();
	private readonly pendingCreations = new Set<Promise<CreateCodingAgentSessionResult>>();
	private closePromise: Promise<void> | undefined;
	private acceptingSessions = true;

	constructor(
		private readonly options: CreateCodingAgentHostOptions,
		private readonly sessionFactory: CodingAgentHostSessionFactory,
	) {}

	async createSession(options: CreateCodingAgentSessionOptions = {}): Promise<CreateCodingAgentSessionResult> {
		if (!this.acceptingSessions) throw new Error("CodingAgentHost is closing or closed");
		let trackedSession: CreateCodingAgentSessionResult["session"] | undefined;
		const operation = this.sessionFactory(
			{ ...this.options.sessionDefaults, ...options },
			{
				onClosed: () => {
					if (trackedSession) this.sessions.delete(trackedSession);
				},
			},
		).then((result) => {
			trackedSession = result.session;
			this.sessions.add(result.session);
			return result;
		});
		this.pendingCreations.add(operation);
		try {
			return await operation;
		} finally {
			this.pendingCreations.delete(operation);
		}
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.acceptingSessions = false;
		const operation = this.closeSessions();
		const tracked = operation.catch((error: unknown) => {
			if (this.closePromise === tracked) this.closePromise = undefined;
			throw error;
		});
		this.closePromise = tracked;
		return tracked;
	}

	private async closeSessions(): Promise<void> {
		await Promise.allSettled([...this.pendingCreations]);
		const sessions = [...this.sessions];
		const results = await Promise.allSettled(sessions.map((session) => session.close()));
		const failures: unknown[] = [];
		for (const [index, result] of results.entries()) {
			if (result.status === "fulfilled") this.sessions.delete(sessions[index]);
			else failures.push(result.reason);
		}
		if (failures.length > 0) throw new AggregateError(failures, "CodingAgentHost failed to close all Sessions");
	}
}
