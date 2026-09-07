import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevProcessEnvironment } from "./run-dev-electron.mjs";

test("development Electron enables local action approval bypass by default", () => {
	assert.equal(resolveDevProcessEnvironment({}).VETTA_DEV_AUTO_APPROVE_ACTIONS, "1");
});

test("development approval bypass can be disabled explicitly", () => {
	assert.equal(
		resolveDevProcessEnvironment({ VETTA_DEV_AUTO_APPROVE_ACTIONS: "0" }).VETTA_DEV_AUTO_APPROVE_ACTIONS,
		"0",
	);
});
