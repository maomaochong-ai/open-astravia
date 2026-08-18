import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadBuildEnv, resolveBuildEnvMode } from "./load-build-env.mjs";

test("defaults pure Node build scripts to the production env", () => {
	assert.equal(resolveBuildEnvMode({}), "production");
});

test("keeps an explicit build env such as the test release mode", () => {
	assert.equal(
		resolveBuildEnvMode({
			VETTA_BUILD_ENV: "test",
		}),
		"test",
	);
});

test("loads the production file before the generic fallback during packaging", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vetta-build-env-"));
	try {
		await writeFile(join(cwd, ".env.production"), "VETTA_SPEECH_INPUT_ENABLED=false\n");
		await writeFile(join(cwd, ".env"), "VETTA_SPEECH_INPUT_ENABLED=true\n");
		const env = {};

		assert.equal(loadBuildEnv({ env, cwd }), "production");
		assert.equal(env.VETTA_SPEECH_INPUT_ENABLED, "false");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("does not override a command-line value", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vetta-build-env-"));
	try {
		await writeFile(join(cwd, ".env.production"), "VETTA_SPEECH_INPUT_ENABLED=false\n");
		const env = {
			VETTA_SPEECH_INPUT_ENABLED: "true",
		};

		loadBuildEnv({ env, cwd });
		assert.equal(env.VETTA_SPEECH_INPUT_ENABLED, "true");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
