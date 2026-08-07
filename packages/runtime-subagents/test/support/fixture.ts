import {
	type SubagentChildFactory,
	SubagentCoordinator,
	type SubagentLifecycle,
	type SubagentSnapshot,
	SubagentTypeRegistry,
} from "../../src/index.js";
import { type TestProfile, typeDefinition } from "./builders.js";
import { TestChild } from "./test-child.js";

export interface FixtureOptions {
	readonly maxConcurrent?: number;
	readonly notificationDelayMs?: number;
	readonly onNotify?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onDeliveryClaimed?: (marker: { readonly id: string; readonly generation: number }) => void;
	readonly onUpdate?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onError?: (error: unknown, operation: string) => void;
	readonly now?: number;
	readonly reopen?: boolean;
	readonly reopenError?: Error;
	readonly lifecycle?: SubagentLifecycle;
	readonly factory?: SubagentChildFactory<TestProfile>;
}

export function createFixture(options: FixtureOptions = {}) {
	const children: TestChild[] = [];
	let nextId = 0;
	const defaultFactory: SubagentChildFactory<TestProfile> = {
		async create() {
			nextId += 1;
			const child = new TestChild(`child-${nextId}`);
			children.push(child);
			return child;
		},
		async reopen(snapshot) {
			if (options.reopenError) throw options.reopenError;
			if (!options.reopen) throw new Error("reopen is disabled");
			const child = new TestChild(snapshot.id);
			children.push(child);
			return child;
		},
	};
	const factory = options.factory ?? defaultFactory;
	const registry = new SubagentTypeRegistry<TestProfile>()
		.register(typeDefinition("explorer"))
		.register(typeDefinition("workflow"));
	const coordinator = new SubagentCoordinator({
		factory,
		typeRegistry: registry,
		parentSessionId: "root-session",
		maxConcurrent: options.maxConcurrent,
		notificationDelayMs: options.notificationDelayMs,
		onNotify: options.onNotify,
		onDeliveryClaimed: options.onDeliveryClaimed,
		onUpdate: options.onUpdate,
		onError: options.onError,
		lifecycle: options.lifecycle,
		clock: options.now === undefined ? undefined : { now: () => options.now ?? 0 },
		idGenerator: { next: () => `reservation-${nextId + 1}` },
	});
	return { coordinator, children };
}
