import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareSpeechModel, prepareSpeechModels, requiresWindowsSpeechModel } from "./fetch-speech-models.mjs";

test("only Windows x64 artifacts require the speech model", () => {
	assert.equal(requiresWindowsSpeechModel(["win32-x64"], {}), true);
	assert.equal(requiresWindowsSpeechModel(["darwin-arm64"], {}), false);
	assert.equal(requiresWindowsSpeechModel(["linux-x64"], {}), false);
	assert.equal(
		requiresWindowsSpeechModel(["win32-x64"], { VETTA_SPEECH_INPUT_ENABLED: "false" }),
		false,
	);
});

test("downloads, verifies, and reuses a prepared model", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-speech-build-test-"));
	const content = Buffer.from("tokens");
	const model = {
		id: "test-model",
		sampleRate: 16_000,
		files: [
			{
				name: "tokens.txt",
				size: content.length,
				sha256: createHash("sha256").update(content).digest("hex"),
				url: "https://example.invalid/tokens.txt",
			},
		],
	};
	let requests = 0;
	const fetchImpl = async () => {
		requests += 1;
		return new Response(content);
	};

	try {
		const modelDirectory = await prepareSpeechModel({
			model,
			targetRoot: root,
			fetchImpl,
			log: () => undefined,
		});
		assert.deepEqual(await readFile(join(modelDirectory, "tokens.txt")), content);
		await prepareSpeechModel({
			model,
			targetRoot: root,
			fetchImpl,
			log: () => undefined,
		});
		assert.equal(requests, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("does not read or download the model for non-Windows targets", async () => {
	let requested = false;
	const result = await prepareSpeechModels({
		env: {},
		platformTags: ["darwin-arm64"],
		manifestPath: "missing.json",
		fetchImpl: async () => {
			requested = true;
			throw new Error("unexpected request");
		},
		log: () => undefined,
	});
	assert.equal(result, null);
	assert.equal(requested, false);
});

test("does not read or download the model for a disabled Windows build", async () => {
	let requested = false;
	const messages = [];
	const result = await prepareSpeechModels({
		env: { VETTA_SPEECH_INPUT_ENABLED: "false" },
		platformTags: ["win32-x64"],
		manifestPath: "missing.json",
		fetchImpl: async () => {
			requested = true;
			throw new Error("unexpected request");
		},
		log: (message) => messages.push(message),
	});
	assert.equal(result, null);
	assert.equal(requested, false);
	assert.deepEqual(messages, ["[speech-models] skipped: VETTA_SPEECH_INPUT_ENABLED=false"]);
});

test("rejects a corrupt download without publishing a model file", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-speech-build-test-"));
	const model = {
		id: "test-model",
		sampleRate: 16_000,
		files: [
			{
				name: "tokens.txt",
				size: 3,
				sha256: createHash("sha256").update("good").digest("hex"),
				url: "https://example.invalid/tokens.txt",
			},
		],
	};
	const destination = join(root, model.id, "tokens.txt");

	try {
		await assert.rejects(
			prepareSpeechModel({
				model,
				targetRoot: root,
				fetchImpl: async () => new Response("bad"),
				log: () => undefined,
			}),
			/Integrity check failed/,
		);
		await assert.rejects(stat(destination));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
