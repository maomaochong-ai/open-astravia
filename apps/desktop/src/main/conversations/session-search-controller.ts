import type { DesktopSessionSearchEvent, DesktopSessionSearchRequest } from "../../shared/session-search.js";

export interface SessionSearchOwner {
	readonly id: number;
	isDestroyed(): boolean;
	on(event: "destroyed", listener: () => void): unknown;
	removeListener(event: "destroyed", listener: () => void): unknown;
}

export interface SessionSearchControllerDependencies {
	readonly run: (
		requestId: string,
		request: DesktopSessionSearchRequest,
		emit: (event: DesktopSessionSearchEvent) => void,
		signal: AbortSignal,
	) => Promise<void>;
	readonly send: (owner: SessionSearchOwner, event: DesktopSessionSearchEvent) => void;
}

/** Request ownership lives here, not in IPC handlers or the worker's index. */
export class SessionSearchController {
	private readonly active = new Map<number, { requestId: string; cancel: () => void }>();

	constructor(private readonly dependencies: SessionSearchControllerDependencies) {}

	start(owner: SessionSearchOwner, rawId: unknown, rawRequest: unknown): void {
		const requestId = parseRequestId(rawId);
		const request = parseSessionSearchRequest(rawRequest);
		this.active.get(owner.id)?.cancel();
		if (owner.isDestroyed()) return;
		const controller = new AbortController();
		const cleanup = () => {
			owner.removeListener("destroyed", cancel);
			if (this.active.get(owner.id)?.cancel === cancel) this.active.delete(owner.id);
		};
		const cancel = () => {
			controller.abort();
			cleanup();
		};
		const emit = (event: DesktopSessionSearchEvent) => {
			if (controller.signal.aborted || owner.isDestroyed()) return;
			this.dependencies.send(owner, { ...event, requestId });
		};
		this.active.set(owner.id, { requestId, cancel });
		owner.on("destroyed", cancel);
		void this.dependencies
			.run(`${owner.id}-${requestId}`, request, emit, controller.signal)
			.catch(() => emit({ requestId, done: true, error: "search-failed" }))
			.finally(cleanup);
	}

	cancel(owner: SessionSearchOwner, rawId: unknown): void {
		const requestId = parseRequestId(rawId);
		const active = this.active.get(owner.id);
		if (active?.requestId === requestId) active.cancel();
	}
}

function parseRequestId(value: unknown): string {
	if (typeof value !== "string" || !/^[\w-]{1,80}$/.test(value)) throw new Error("Invalid search request id");
	return value;
}

export function parseSessionSearchRequest(value: unknown): DesktopSessionSearchRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid search request");
	const query = Reflect.get(value, "query");
	const limit = Reflect.get(value, "limit");
	const sourceKind = Reflect.get(value, "sourceKind");
	const projectCwd = Reflect.get(value, "projectCwd");
	const modifiedFrom = parseTimeBound(Reflect.get(value, "modifiedFrom"));
	const modifiedBefore = parseTimeBound(Reflect.get(value, "modifiedBefore"));
	if (modifiedFrom !== undefined && modifiedBefore !== undefined && modifiedFrom >= modifiedBefore)
		throw new Error("Invalid search time range");
	if (typeof query !== "string" || query.length > 200) throw new Error("Invalid search query");
	if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100))
		throw new Error("Invalid search limit");
	if (
		sourceKind !== undefined &&
		sourceKind !== "conversation" &&
		sourceKind !== "claw" &&
		sourceKind !== "project" &&
		sourceKind !== "batch"
	)
		throw new Error("Invalid search type");
	if (projectCwd !== undefined && (typeof projectCwd !== "string" || !projectCwd.trim() || projectCwd.length > 4096))
		throw new Error("Invalid search project");
	return { query: query.trim(), limit, sourceKind, projectCwd, modifiedFrom, modifiedBefore };
}

function parseTimeBound(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 8_640_000_000_000_000)
		throw new Error("Invalid search time bound");
	return value;
}
