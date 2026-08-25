import type { Message } from "@vetta/ai";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core";
import { RuntimeConfigurationCenter, RuntimeConfigurationSnapshotCoordinator } from "@vetta/runtime-core/configuration";
import type {
	ModelCallMessageFinalizationInput,
	RuntimeSnapshotAcquireContext,
	RuntimeTurnModelBinding,
} from "@vetta/runtime-core/kernel";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import { CodingAgentLegacyImageSettingsRuntime } from "../src/adapters/settings/legacy-image-settings-adapter.js";
import { CodingAgentImageSettingsSnapshotRouter } from "../src/composition/turn/image-settings-snapshot-router.js";
import { CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION } from "../src/model-context/image-settings-observations.js";
import { CodingAgentModelCallMessageFinalizer } from "../src/model-context/model-call-message-finalizer.js";

describe("Coding Agent legacy image settings configuration", () => {
	it("uses Definition defaults when the legacy source has no image settings", async () => {
		const runtime = new CodingAgentLegacyImageSettingsRuntime();
		const lease = runtime.acquire(binding("turn-default"));

		expect(lease.snapshot.read(CODING_IMAGE_CONFIGURATION)).toEqual(CODING_IMAGE_CONFIGURATION.defaultValue);
		await lease.release();
		await runtime.close();
	});

	it("shares a stable generation within a Turn and applies changes to the next Turn", async () => {
		let autoResize = true;
		let reloads = 0;
		const runtime = new CodingAgentLegacyImageSettingsRuntime({
			settings: {
				reloadImageSettings: () => {
					reloads += 1;
				},
				getImageAutoResize: () => autoResize,
				getBlockImages: () => false,
			},
		});
		const first = runtime.acquire(binding("turn-1"));
		autoResize = false;
		const sameTurn = runtime.acquire(binding("turn-1"));
		const nextTurn = runtime.acquire(binding("turn-2"));

		expect(first.snapshot).toBe(sameTurn.snapshot);
		expect(first.snapshot.read(CODING_IMAGE_CONFIGURATION)?.autoResize).toBe(true);
		expect(nextTurn.snapshot.read(CODING_IMAGE_CONFIGURATION)?.autoResize).toBe(false);
		expect(reloads).toBe(2);
		await first.release();
		await sameTurn.release();
		await nextTurn.release();
		await runtime.close();
	});

	it("projects the complete legacy image document into the shared configuration", async () => {
		const runtime = new CodingAgentLegacyImageSettingsRuntime({
			settings: {
				getImageSettings: () => ({
					autoResize: true,
					resize: { maxWidth: 640, jpegQuality: 82 },
					requestBudget: { highWatermarkBytes: 9_000_000, lowWatermarkBytes: 7_000_000 },
				}),
			},
		});
		const lease = runtime.acquire(binding("turn-full-image-settings"));

		expect(lease.snapshot.read(CODING_IMAGE_CONFIGURATION)).toMatchObject({
			resize: { maxWidth: 640, maxHeight: 1280, jpegQuality: 82 },
			requestBudget: { highWatermarkBytes: 9_000_000, lowWatermarkBytes: 7_000_000 },
		});
		await lease.release();
		await runtime.close();
	});

	it("keeps last-known-good settings and emits a value-free warning when reload fails", async () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					records.push(record);
				},
			},
		});
		let fail = false;
		const runtime = new CodingAgentLegacyImageSettingsRuntime({
			settings: {
				reloadImageSettings: () => {
					if (fail) throw new Error("SECRET_SETTINGS_PATH");
				},
				getImageAutoResize: () => false,
			},
			observationPublisher: publisher,
		});
		const initial = runtime.acquire(binding("turn-1"));
		await initial.release();
		fail = true;
		const fallback = runtime.acquire(binding("turn-2"));

		expect(fallback.snapshot.read(CODING_IMAGE_CONFIGURATION)?.autoResize).toBe(false);
		expect(records.some(({ token }) => token === CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION)).toBe(true);
		expect(JSON.stringify(records)).not.toContain("SECRET_SETTINGS_PATH");
		await fallback.release();
		await runtime.close();
	});

	it("binds the model message finalizer to the Runtime Configuration snapshot", async () => {
		let blockImages = false;
		const runtime = new CodingAgentLegacyImageSettingsRuntime({
			settings: {
				getImageAutoResize: () => false,
				getBlockImages: () => blockImages,
			},
		});
		const finalizer = new CodingAgentModelCallMessageFinalizer(undefined, undefined, runtime);
		const first = finalizer.bindForTurn(turnContext("turn-1"));
		blockImages = true;
		const second = finalizer.bindForTurn(turnContext("turn-2"));
		const messages = [
			{
				role: "user" as const,
				timestamp: 1,
				content: [{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }],
			},
		];

		expect(await first.finalize(finalizationInput(messages, "turn-1"), new AbortController().signal)).toEqual(
			messages,
		);
		expect(await second.finalize(finalizationInput(messages, "turn-2"), new AbortController().signal)).toEqual([
			{ role: "user", timestamp: 1, content: [{ type: "text", text: "Image reading is disabled." }] },
		]);
		await first.releaseTurnBinding?.();
		await second.releaseTurnBinding?.();
		await runtime.close();
	});

	it("routes Session ownership atomically across a Session id rebind", async () => {
		const runtime = new CodingAgentLegacyImageSettingsRuntime({
			settings: { getImageAutoResize: () => false },
		});
		const router = new CodingAgentImageSettingsSnapshotRouter();
		router.register("temporary-session", runtime);
		const before = router.acquire({ scopeId: "temporary-session", bindingId: "turn-1" });
		router.rebind("temporary-session", "persisted-session", runtime);

		expect(() => router.acquire({ scopeId: "temporary-session", bindingId: "turn-2" })).toThrow(
			"scope is unavailable",
		);
		const after = router.acquire({ scopeId: "persisted-session", bindingId: "turn-2" });
		expect(before.snapshot.read(CODING_IMAGE_CONFIGURATION)?.autoResize).toBe(false);
		expect(after.snapshot.read(CODING_IMAGE_CONFIGURATION)?.autoResize).toBe(false);

		await before.release();
		await after.release();
		router.unregister("persisted-session", runtime);
		await runtime.close();
	});

	it("passes configured resize limits to the model-input processor", async () => {
		const center = new RuntimeConfigurationCenter();
		center.definitions.upsert({
			source: { id: "runtime-tools", revision: "1" },
			definition: CODING_IMAGE_CONFIGURATION,
		});
		center.layers.replaceSource({ id: "test-settings", revision: "1" }, [
			{
				id: "test.images",
				revision: "1",
				precedence: 100,
				values: { [CODING_IMAGE_CONFIGURATION.id]: { resize: { maxWidth: 777 } } },
			},
		]);
		const capturedWidths: number[] = [];
		const finalizer = new CodingAgentModelCallMessageFinalizer(
			undefined,
			{
				async resize(data, mimeType, _signal, options) {
					capturedWidths.push(options?.maxWidth ?? -1);
					return { data, mimeType };
				},
			},
			new RuntimeConfigurationSnapshotCoordinator(center),
		);
		const bound = finalizer.bindForTurn(turnContext("turn-configured-resize"));

		await bound.finalize(
			finalizationInput(
				[
					{
						role: "user",
						timestamp: 1,
						content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
					},
				],
				"turn-configured-resize",
			),
			new AbortController().signal,
		);

		expect(capturedWidths).toEqual([777]);
		await bound.releaseTurnBinding?.();
		await center.close();
	});
});

function binding(bindingId: string) {
	return { scopeId: "session-1", bindingId, signal: new AbortController().signal };
}

function turnContext(operationId: string): RuntimeSnapshotAcquireContext {
	return {
		sessionId: "session-1",
		operationId,
		reason: "turn",
		signal: new AbortController().signal,
	};
}

const TEST_MODEL_BINDING = {
	model: {
		id: "test-model",
		name: "Test model",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	},
} satisfies RuntimeTurnModelBinding;

function finalizationInput(messages: readonly Message[], turnId: string): ModelCallMessageFinalizationInput {
	return { sessionId: "session-1", turnId, messages, modelBinding: TEST_MODEL_BINDING };
}
