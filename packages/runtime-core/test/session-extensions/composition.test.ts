import type { UserMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
	defineSessionExtensionService,
	defineSessionExtensionSignal,
	SessionExtensionComposition,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "../../src/index.js";

const BASE_SERVICE = defineSessionExtensionService<{ readonly value: number }>("base", "value");
const READ_VALUE = defineSessionExtensionEndpoint<void, number>("dependent", "read-value");
const READ_VALUE_ASYNC = defineSessionExtensionEndpoint<void, number>("dependent", "read-value-async");
const CHANGED = defineSessionExtensionSignal<number>("base", "changed");
const OBSERVED = defineSessionExtensionObservation<{ readonly value: number }>("base", "observed");

describe("SessionExtensionComposition", () => {
	it("creates typed product-neutral observation envelopes", () => {
		expect(sessionExtensionObservation(OBSERVED, { value: 42 })).toEqual({
			type: "session.extension",
			extensionId: "base",
			event: "observed",
			payload: { value: 42 },
		});
	});

	it("creates dependencies first and exposes typed services and endpoints", async () => {
		const lifecycle: string[] = [];
		const composition = await SessionExtensionComposition.create({
			definitions: [dependentExtension(lifecycle), baseExtension(lifecycle)],
		});

		expect(lifecycle).toEqual(["create:base", "create:dependent"]);
		expect(composition.services.require(BASE_SERVICE)).toEqual({ value: 42 });
		expect(composition.hasEndpoint(READ_VALUE)).toBe(true);
		expect(composition.invokeSync(READ_VALUE, undefined)).toBe(42);
		expect(composition.readInitialObservations()).toEqual([sessionExtensionObservation(OBSERVED, { value: 42 })]);
		await expect(composition.invoke(READ_VALUE, undefined)).resolves.toBe(42);
		await expect(composition.invoke(READ_VALUE_ASYNC, undefined)).resolves.toBe(42);
		expect(() => composition.invokeSync(READ_VALUE_ASYNC, undefined)).toThrow("is asynchronous");
		await composition.dispose();
		expect(lifecycle.slice(-2)).toEqual(["dispose:dependent", "dispose:base"]);
		expect(() => composition.readInitialObservations()).toThrow("disposed");
	});

	it("rolls back initialized extensions when a later extension fails", async () => {
		const lifecycle: string[] = [];
		const broken: SessionExtensionDefinition = {
			id: "broken",
			dependencies: ["base"],
			create() {
				lifecycle.push("create:broken");
				throw new Error("broken extension");
			},
		};
		await expect(
			SessionExtensionComposition.create({ definitions: [baseExtension(lifecycle), broken] }),
		).rejects.toThrow("broken extension");
		expect(lifecycle).toEqual(["create:base", "create:broken", "dispose:base"]);
	});

	it("preserves both initialization and rollback failures", async () => {
		const brokenBase: SessionExtensionDefinition = {
			id: "base",
			create: () => ({
				contributions: [],
				dispose() {
					throw new Error("rollback failed");
				},
			}),
		};
		const brokenDependent: SessionExtensionDefinition = {
			id: "dependent",
			dependencies: ["base"],
			create() {
				throw new Error("initialization failed");
			},
		};

		const error = await SessionExtensionComposition.create({
			definitions: [brokenBase, brokenDependent],
		}).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors).toHaveLength(2);
		expect((error as AggregateError).errors[0]).toEqual(new Error("initialization failed"));
	});

	it("enforces declared service dependencies", async () => {
		const invalid: SessionExtensionDefinition = {
			id: "invalid",
			create(context) {
				context.services.require(BASE_SERVICE);
				return { contributions: [], dispose() {} };
			},
		};
		await expect(SessionExtensionComposition.create({ definitions: [baseExtension([]), invalid] })).rejects.toThrow(
			"must declare dependency on base",
		);
	});

	it("rejects duplicate initial observation source ids", async () => {
		const extension = (id: string): SessionExtensionDefinition => ({
			id,
			create: () => ({
				contributions: [
					{
						kind: "initial-observation-source",
						source: { id: "shared.initial-state", read: () => [] },
					},
				],
				dispose() {},
			}),
		});

		await expect(
			SessionExtensionComposition.create({ definitions: [extension("first"), extension("second")] }),
		).rejects.toThrow("Duplicate session extension initial observation source id: shared.initial-state");
	});

	it("does not initialize extensions when creation is already aborted", async () => {
		const create = vi.fn(() => ({ contributions: [], dispose() {} }));
		const controller = new AbortController();
		controller.abort();

		await expect(
			SessionExtensionComposition.create({ definitions: [{ id: "aborted", create }], signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(create).not.toHaveBeenCalled();
	});

	it("marks an empty composition as disposed", async () => {
		const composition = await SessionExtensionComposition.create({ definitions: [] });

		await composition.dispose();

		expect(composition.hasEndpoint(READ_VALUE)).toBe(false);
		expect(() => composition.readInitialObservations()).toThrow("disposed");
	});

	it("isolates signal listener failures", async () => {
		const composition = await SessionExtensionComposition.create({ definitions: [baseExtension([])] });
		const values: number[] = [];
		composition.signals.subscribe(CHANGED, () => {
			throw new Error("observer failed");
		});
		composition.signals.subscribe(CHANGED, (value) => values.push(value));
		composition.signals.publish(CHANGED, 7);
		expect(values).toEqual([7]);
		await composition.dispose();
	});

	it("composes continuation sources by priority and stops at the first result", async () => {
		const calls: string[] = [];
		const message: UserMessage = { role: "user", content: "continue", timestamp: 1 };
		const composition = await SessionExtensionComposition.create({
			definitions: [continuationExtension(calls, message)],
		});
		const result = await composition.createContinuationPolicy()?.collect({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages: [],
		});
		expect(calls).toEqual(["first", "later"]);
		expect(result).toEqual([{ message, source: "later" }]);
		await composition.dispose();
	});

	it("retries only failed extension disposals", async () => {
		const lifecycle: string[] = [];
		let attempts = 0;
		const extension = (id: string, failOnce = false): SessionExtensionDefinition => ({
			id,
			create: () => ({
				contributions: [],
				dispose() {
					lifecycle.push(id);
					if (failOnce && attempts++ === 0) throw new Error(`dispose:${id}`);
				},
			}),
		});
		const composition = await SessionExtensionComposition.create({
			definitions: [extension("first"), extension("second", true)],
		});

		await expect(composition.dispose()).rejects.toMatchObject({ errors: expect.any(Array) });
		expect(lifecycle).toEqual(["second", "first"]);
		await expect(composition.dispose()).resolves.toBeUndefined();
		expect(lifecycle).toEqual(["second", "first", "second"]);
		await expect(composition.dispose()).resolves.toBeUndefined();
		expect(lifecycle).toEqual(["second", "first", "second"]);
	});
});

function baseExtension(lifecycle: string[]): SessionExtensionDefinition {
	return {
		id: "base",
		create(context) {
			lifecycle.push("create:base");
			context.signals.publish(CHANGED, 1);
			return {
				contributions: [
					{ kind: "service", token: BASE_SERVICE, value: { value: 42 } },
					{
						kind: "initial-observation-source",
						source: {
							id: "base.initial-state",
							read: () => [sessionExtensionObservation(OBSERVED, { value: 42 })],
						},
					},
				],
				dispose() {
					lifecycle.push("dispose:base");
				},
			};
		},
	};
}

function dependentExtension(lifecycle: string[]): SessionExtensionDefinition {
	return {
		id: "dependent",
		dependencies: ["base"],
		create(context) {
			lifecycle.push("create:dependent");
			const service = context.services.require(BASE_SERVICE);
			return {
				contributions: [
					{ kind: "endpoint", token: READ_VALUE, handle: () => service.value },
					{ kind: "endpoint", token: READ_VALUE_ASYNC, handle: async () => service.value },
				],
				dispose() {
					lifecycle.push("dispose:dependent");
				},
			};
		},
	};
}

function continuationExtension(calls: string[], message: UserMessage): SessionExtensionDefinition {
	const source = (id: string, priority: number, messages: readonly UserMessage[]) => ({
		id,
		priority,
		async collect() {
			calls.push(id);
			return messages;
		},
	});
	return {
		id: "continuations",
		create: () => ({
			contributions: [
				{ kind: "continuation-source", source: source("later", 20, [message]) },
				{ kind: "continuation-source", source: source("first", 10, []) },
			],
			dispose() {},
		}),
	};
}
