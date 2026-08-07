import { describe, expect, it, vi } from "vitest";
import type { ConversationDocumentStore } from "../../src/conversation/index.js";
import type { ConversationRepository, EventSink, RuntimeSnapshotProvider } from "../../src/kernel/index.js";
import { ComposedRuntimeFactory, type RuntimeResources } from "../../src/runtime-host/composed-runtime-factory.js";
import type { RuntimePromptAdapter } from "../../src/runtime-host/kernel-runtime-session-backend.js";
import type { RuntimeModelRuntime } from "../../src/runtime-host/runtime-model.js";

describe("ComposedRuntimeFactory initialization", () => {
	it("closes an acquired Kernel session before resources and can initialize again", async () => {
		const initializationError = new Error("peripheral initialization failed");
		const order: string[] = [];
		let attempts = 0;
		const disposeResources = vi.fn(async () => {
			order.push("resources");
		});
		const factory = new ComposedRuntimeFactory<Record<string, never>>({
			createResources: async () => ({
				sessionId: "factory-session",
				repository: { create: vi.fn(async () => undefined) } as unknown as ConversationRepository,
				conversationDocumentStore: {} as ConversationDocumentStore,
				promptAdapter: {} as RuntimePromptAdapter,
				snapshotProvider: {} as RuntimeSnapshotProvider,
				modelRuntime: {} as RuntimeModelRuntime,
				identity: { cwd: "C:/workspace" },
				stateSource: { read: () => ({ contextPercent: 0, contextWindow: 8_000, activeToolNames: [] }) },
				createSessionPeripherals: (session) => {
					attempts += 1;
					vi.spyOn(session, "close").mockImplementation(async () => {
						order.push("session");
					});
					if (attempts === 1) throw initializationError;
					return {};
				},
				dispose: disposeResources,
			}),
		});
		const eventSink: EventSink = { publish: vi.fn(async () => undefined) };

		await expect(factory.create({}, eventSink)).rejects.toBe(initializationError);
		expect(order).toEqual(["session", "resources"]);

		const assembly = await factory.create({}, eventSink);
		await assembly.session.close();
		await assembly.dispose?.();
		expect(attempts).toBe(2);
		expect(disposeResources).toHaveBeenCalledTimes(2);
	});

	it("rolls back when final assembly projection fails before publication", async () => {
		const publicationError = new Error("assembly projection failed");
		const order: string[] = [];
		const factory = new ComposedRuntimeFactory<Record<string, never>>({
			createResources: async () => ({
				sessionId: "factory-publication-session",
				repository: { create: vi.fn(async () => undefined) } as unknown as ConversationRepository,
				conversationDocumentStore: {} as ConversationDocumentStore,
				promptAdapter: {} as RuntimePromptAdapter,
				snapshotProvider: {} as RuntimeSnapshotProvider,
				modelRuntime: {} as RuntimeModelRuntime,
				identity: { cwd: "C:/workspace" },
				stateSource: { read: () => ({ contextPercent: 0, contextWindow: 8_000, activeToolNames: [] }) },
				createSessionPeripherals: (session) => {
					vi.spyOn(session, "close").mockImplementation(async () => {
						order.push("session");
					});
					return {};
				},
				get toolController(): RuntimeResources["toolController"] {
					throw publicationError;
				},
				dispose: async () => {
					order.push("resources");
				},
			}),
		});

		await expect(factory.create({}, { publish: vi.fn(async () => undefined) })).rejects.toBe(publicationError);
		expect(order).toEqual(["session", "resources"]);
	});
});
