import assert from "node:assert/strict";
import test from "node:test";
import { resolveElectronBuilderPublishMode } from "./run-electron-builder.js";

test("electron-builder never publishes unless the caller explicitly opts in", () => {
	assert.equal(resolveElectronBuilderPublishMode(undefined), "never");
	assert.equal(resolveElectronBuilderPublishMode("always"), "always");
});
