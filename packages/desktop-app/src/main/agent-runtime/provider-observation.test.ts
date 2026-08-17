import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderCallObservation } from "@vetta/ai/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationCacheService } from "../cache/application-cache-service.js";
import { createDesktopProviderObservationRuntime, NdjsonProviderObservationSink } from "./provider-observation.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop provider observation runtime", () => {
	it("is disabled outside UI verification and without an explicit run id", () => {
		expect(
			createDesktopProviderObservationRuntime({
				environment: { VETTA_PROVIDER_OBSERVATION_RUN_ID: "experiment-1" },
			}),
		).toBeUndefined();
		expect(createDesktopProviderObservationRuntime({ environment: { VETTA_UI_VERIFICATION: "1" } })).toBeUndefined();
	});

	it("creates an isolated trace path and validates capture configuration", async () => {
		const root = await createTemporaryRoot();
		const cacheService = new ApplicationCacheService(root);
		const runtime = createDesktopProviderObservationRuntime({
			cacheService,
			environment: {
				VETTA_UI_VERIFICATION: "1",
				VETTA_PROVIDER_OBSERVATION_RUN_ID: "cache-run_1",
				VETTA_PROVIDER_OBSERVATION_CAPTURE: "payload",
			},
		});

		expect(runtime?.tracePath).toBe(join(root, "provider-observations", "cache-run_1.ndjson"));
		expect(runtime?.streamFn).toBeTypeOf("function");
		expect(() =>
			createDesktopProviderObservationRuntime({
				cacheService,
				environment: {
					VETTA_UI_VERIFICATION: "1",
					VETTA_PROVIDER_OBSERVATION_RUN_ID: "invalid/path",
				},
			}),
		).toThrow("VETTA_PROVIDER_OBSERVATION_RUN_ID");
	});

	it("serializes concurrent observations as complete NDJSON records", async () => {
		const root = await createTemporaryRoot();
		const namespace = new ApplicationCacheService(root).namespace("provider-observations");
		const tracePath = namespace.path("run.ndjson");
		const sink = new NdjsonProviderObservationSink(namespace.ensure(), tracePath);
		const first = observation("first");
		const second = observation("second");

		await Promise.all([sink.record(first), sink.record(second)]);

		const records = (await readFile(tracePath, "utf-8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(records).toEqual([first, second]);
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-provider-observation-test-"));
	temporaryRoots.push(root);
	return root;
}

function observation(callId: string): ProviderCallObservation {
	return {
		schemaVersion: 1,
		callId,
		startedAt: "2026-08-15T00:00:00.000Z",
		durationMs: 1,
		capture: "metadata",
		model: { api: "test-api", provider: "test-provider", id: "test-model" },
		request: {
			messageCount: 0,
			toolCount: 0,
			promptCache: {
				cachePrefixHash: "pc1:cache",
				stableSystemPromptHash: "pc1:stable",
				volatileSystemPromptHash: "pc1:volatile",
				toolsHash: "pc1:tools",
				historyPrefixHash: "pc1:history",
				stableSystemPromptLength: 0,
				volatileSystemPromptLength: 0,
				historyPrefixMessages: 0,
				toolCount: 0,
			},
		},
	};
}
