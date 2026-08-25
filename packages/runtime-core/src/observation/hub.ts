import type {
	RuntimeObservationContext,
	RuntimeObservationFailure,
	RuntimeObservationLevel,
	RuntimeObservationPort,
	RuntimeObservationPublisher,
	RuntimeObservationRecord,
} from "./contracts.js";
import {
	createRuntimeObservationPublisher,
	defineRuntimeObservation,
	runtimeObservationFailure,
} from "./observation.js";

const PARENT_ROUTE_ID = "$parent";

export type RuntimeObservationHubIssueOperation =
	| "adapter.filter"
	| "adapter.record"
	| "adapter.flush"
	| "hub.capacity"
	| "hub.closed";

export interface RuntimeObservationHubIssue {
	readonly operation: RuntimeObservationHubIssueOperation;
	readonly phase: "failed" | "dropped";
	readonly adapterId?: string;
	readonly failure?: RuntimeObservationFailure;
}

export const RUNTIME_OBSERVATION_HUB_ISSUE = defineRuntimeObservation<RuntimeObservationHubIssue>(
	"runtime.observation",
	"hub-issue",
	"warning",
);

export interface RuntimeObservationRouteOptions {
	readonly id: string;
	readonly domains?: readonly string[];
	readonly levels?: readonly RuntimeObservationLevel[];
	readonly predicate?: (record: RuntimeObservationRecord) => boolean;
}

export interface RuntimeObservationRouteRegistration {
	readonly id: string;
	detach(): boolean;
}

export interface RuntimeObservationHubOptions {
	/** 父级 Hub/Port 不归当前 Hub 所有；记录会原样上送，但 close 不关闭父级。 */
	readonly parent?: RuntimeObservationPort;
	/** 限制 fire-and-forget 在途记录；达到上限时安全丢弃并报告计数。 */
	readonly maxPendingRecords?: number;
	readonly now?: () => number;
	/** Hub 自身问题的进程内安全通知；回调失败同样被隔离。 */
	readonly onIssue?: (issue: RuntimeObservationHubIssue) => void;
}

export interface RuntimeObservationHubSnapshot {
	readonly closed: boolean;
	readonly adapterIds: readonly string[];
	readonly publishedRecordCount: number;
	readonly routedDeliveryCount: number;
	readonly filteredDeliveryCount: number;
	readonly deliveryFailureCount: number;
	readonly droppedRecordCount: number;
	readonly pendingRecordCount: number;
}

/** Hub 的非所有权控制面；允许宿主动态接入 Adapter 与读取健康度，但不能关闭模块拥有的 Hub。 */
export interface RuntimeObservationHubView {
	attach(port: RuntimeObservationPort, options: RuntimeObservationRouteOptions): RuntimeObservationRouteRegistration;
	snapshot(): RuntimeObservationHubSnapshot;
}

interface RuntimeObservationRoute {
	readonly id: string;
	readonly port: RuntimeObservationPort;
	readonly domains?: ReadonlySet<string>;
	readonly levels?: ReadonlySet<RuntimeObservationLevel>;
	readonly predicate?: RuntimeObservationRouteOptions["predicate"];
}

interface DeliveryTarget {
	readonly id: string;
	readonly port: RuntimeObservationPort;
}

/**
 * 可独立、可嵌套的安全观测路由中心。
 *
 * Hub 只统一信封、身份、路由和 Adapter 生命周期，不解释领域 payload，也不拥有父级 Port。
 */
export class RuntimeObservationHub implements RuntimeObservationPort, RuntimeObservationHubView {
	private readonly routes = new Map<string, RuntimeObservationRoute>();
	private readonly pendingRecords = new Set<Promise<void>>();
	private readonly parent: RuntimeObservationPort | undefined;
	private readonly maxPendingRecords: number;
	private readonly now: () => number;
	private readonly onIssue: RuntimeObservationHubOptions["onIssue"];
	private publishedRecordCount = 0;
	private routedDeliveryCount = 0;
	private filteredDeliveryCount = 0;
	private deliveryFailureCount = 0;
	private droppedRecordCount = 0;
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(options: RuntimeObservationHubOptions = {}) {
		this.parent = options.parent;
		this.maxPendingRecords = normalizePendingLimit(options.maxPendingRecords);
		this.now = options.now ?? Date.now;
		this.onIssue = options.onIssue;
	}

	publisher(context: RuntimeObservationContext = {}): RuntimeObservationPublisher {
		return createRuntimeObservationPublisher({ port: this, context, now: this.now });
	}

	attach(port: RuntimeObservationPort, options: RuntimeObservationRouteOptions): RuntimeObservationRouteRegistration {
		this.assertOpen();
		const id = requireRouteId(options.id);
		if (id === PARENT_ROUTE_ID || this.routes.has(id)) {
			throw new Error(`Runtime observation route is already registered: ${id}`);
		}
		const route = Object.freeze({
			id,
			port,
			...(options.domains ? { domains: new Set(options.domains.map(requireDomain)) } : {}),
			...(options.levels ? { levels: new Set(options.levels) } : {}),
			...(options.predicate ? { predicate: options.predicate } : {}),
		});
		this.routes.set(id, route);
		let attached = true;
		return Object.freeze({
			id,
			detach: () => {
				if (!attached) return false;
				attached = false;
				return this.routes.delete(id);
			},
		});
	}

	record(record: RuntimeObservationRecord): Promise<void> {
		if (this.closed) {
			this.droppedRecordCount += 1;
			this.notifyIssue({ operation: "hub.closed", phase: "dropped" });
			return Promise.resolve();
		}
		if (this.pendingRecords.size >= this.maxPendingRecords) {
			this.droppedRecordCount += 1;
			this.notifyIssue({ operation: "hub.capacity", phase: "dropped" });
			return Promise.resolve();
		}
		this.publishedRecordCount += 1;
		const task = this.routeRecord(record);
		this.pendingRecords.add(task);
		void task.finally(() => this.pendingRecords.delete(task));
		return task;
	}

	async flush(): Promise<void> {
		while (this.pendingRecords.size > 0) {
			await Promise.allSettled([...this.pendingRecords]);
		}
		const targets = this.deliveryTargets();
		const outcomes = await Promise.all(
			targets.map(async ({ id, port }) => {
				try {
					await port.flush?.();
					return undefined;
				} catch (error) {
					return { id, error };
				}
			}),
		);
		for (const outcome of outcomes) {
			if (!outcome) continue;
			this.deliveryFailureCount += 1;
			await this.emitIssue(
				{
					operation: "adapter.flush",
					phase: "failed",
					adapterId: outcome.id,
					failure: runtimeObservationFailure(outcome.error),
				},
				new Set([outcome.id]),
			);
		}
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.closePromise = this.flush();
		return this.closePromise;
	}

	snapshot(): RuntimeObservationHubSnapshot {
		return Object.freeze({
			closed: this.closed,
			adapterIds: Object.freeze([...this.routes.keys()].sort()),
			publishedRecordCount: this.publishedRecordCount,
			routedDeliveryCount: this.routedDeliveryCount,
			filteredDeliveryCount: this.filteredDeliveryCount,
			deliveryFailureCount: this.deliveryFailureCount,
			droppedRecordCount: this.droppedRecordCount,
			pendingRecordCount: this.pendingRecords.size,
		});
	}

	private async routeRecord(record: RuntimeObservationRecord): Promise<void> {
		const targets: DeliveryTarget[] = this.parent ? [{ id: PARENT_ROUTE_ID, port: this.parent }] : [];
		const filterFailures: Array<{ readonly id: string; readonly error: unknown }> = [];
		for (const route of this.routes.values()) {
			try {
				if (!matchesRoute(route, record)) {
					this.filteredDeliveryCount += 1;
					continue;
				}
				targets.push({ id: route.id, port: route.port });
			} catch (error) {
				this.deliveryFailureCount += 1;
				filterFailures.push({ id: route.id, error });
			}
		}
		this.routedDeliveryCount += targets.length;
		const outcomes = await Promise.all(
			targets.map(async ({ id, port }) => {
				try {
					await port.record(record);
					return undefined;
				} catch (error) {
					return { id, error };
				}
			}),
		);
		for (const failure of filterFailures) {
			await this.emitIssue(
				{
					operation: "adapter.filter",
					phase: "failed",
					adapterId: failure.id,
					failure: runtimeObservationFailure(failure.error),
				},
				new Set([failure.id]),
			);
		}
		for (const outcome of outcomes) {
			if (!outcome) continue;
			this.deliveryFailureCount += 1;
			await this.emitIssue(
				{
					operation: "adapter.record",
					phase: "failed",
					adapterId: outcome.id,
					failure: runtimeObservationFailure(outcome.error),
				},
				new Set([outcome.id]),
			);
		}
	}

	private async emitIssue(issue: RuntimeObservationHubIssue, excluded = new Set<string>()): Promise<void> {
		this.notifyIssue(issue);
		const record: RuntimeObservationRecord<RuntimeObservationHubIssue> = Object.freeze({
			token: RUNTIME_OBSERVATION_HUB_ISSUE,
			context: Object.freeze({}),
			timestamp: this.now(),
			payload: Object.freeze({ ...issue }),
		});
		const targets: DeliveryTarget[] =
			this.parent && !excluded.has(PARENT_ROUTE_ID) ? [{ id: PARENT_ROUTE_ID, port: this.parent }] : [];
		for (const route of this.routes.values()) {
			if (excluded.has(route.id)) continue;
			try {
				if (matchesRoute(route, record)) targets.push({ id: route.id, port: route.port });
			} catch {
				// A diagnostic must not recursively diagnose a failing filter.
			}
		}
		await Promise.allSettled(
			targets.map(async ({ port }) => {
				await port.record(record);
			}),
		);
	}

	private notifyIssue(issue: RuntimeObservationHubIssue): void {
		try {
			this.onIssue?.(issue);
		} catch {
			// Hub diagnostics must never change the observed flow.
		}
	}

	private deliveryTargets(): readonly DeliveryTarget[] {
		return [
			...(this.parent ? [{ id: PARENT_ROUTE_ID, port: this.parent }] : []),
			...[...this.routes.values()].map(({ id, port }) => ({ id, port })),
		];
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("Runtime observation hub is closed");
	}
}

function matchesRoute(route: RuntimeObservationRoute, record: RuntimeObservationRecord): boolean {
	if (route.domains && !route.domains.has(record.token.domain)) return false;
	if (route.levels && !route.levels.has(record.token.level)) return false;
	return route.predicate?.(record) ?? true;
}

function normalizePendingLimit(value: number | undefined): number {
	if (value === undefined) return Number.POSITIVE_INFINITY;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error("Runtime observation maxPendingRecords must be a positive integer");
	}
	return value;
}

function requireRouteId(value: string): string {
	const normalized = value.trim();
	if (!normalized || normalized !== value) {
		throw new Error("Runtime observation route id must be a non-empty trimmed string");
	}
	return normalized;
}

function requireDomain(value: string): string {
	const normalized = value.trim();
	if (!normalized || normalized !== value) {
		throw new Error("Runtime observation route domain must be a non-empty trimmed string");
	}
	return normalized;
}
