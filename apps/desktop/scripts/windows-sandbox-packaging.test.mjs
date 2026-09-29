import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	stageWindowsSandboxBinaries,
	WINDOWS_SANDBOX_BINARY_NAMES,
} from "./windows-sandbox-packaging.mjs";

function withSandboxFixture(run) {
	const root = mkdtempSync(join(tmpdir(), "vetta-windows-sandbox-packaging-"));
	try {
		return run({ root, sourceDir: join(root, "source"), destinationDir: join(root, "destination") });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("stages every required Windows sandbox binary", () => {
	withSandboxFixture(({ sourceDir, destinationDir }) => {
		mkdirSync(sourceDir, { recursive: true });
		for (const binaryName of WINDOWS_SANDBOX_BINARY_NAMES) {
			writeFileSync(join(sourceDir, binaryName), `fixture:${binaryName}`);
		}

		stageWindowsSandboxBinaries({ sourceDir, destinationDir });

		for (const binaryName of WINDOWS_SANDBOX_BINARY_NAMES) {
			assert.equal(readFileSync(join(destinationDir, binaryName), "utf8"), `fixture:${binaryName}`);
		}
	});
});

test("fails packaging when any required Windows sandbox binary is missing", () => {
	withSandboxFixture(({ sourceDir, destinationDir }) => {
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, WINDOWS_SANDBOX_BINARY_NAMES[0]), "fixture");

		assert.throws(
			() => stageWindowsSandboxBinaries({ sourceDir, destinationDir }),
			(error) => {
				assert.match(error.message, /required Windows sandbox binaries are missing/);
				for (const binaryName of WINDOWS_SANDBOX_BINARY_NAMES.slice(1)) {
					assert.match(error.message, new RegExp(binaryName.replaceAll(".", "\\.")));
				}
				return true;
			},
		);
	});
});
