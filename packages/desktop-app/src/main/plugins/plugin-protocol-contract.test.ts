import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as pluginSdk from "../../../../plugins/plugin-sdk/src/index.js";
import * as vettaUi from "../../../../ui/src/index.js";

const protocolSource = readFileSync(new URL("./plugin-protocol.ts", import.meta.url), "utf8");

describe("vetta-host plugin-sdk protocol", () => {
	it("forwards every public runtime export", () => {
		const forwardedExports = protocolSource
			.split(/\r?\n/u)
			.map((line) => /^export const ([A-Za-z_$][\w$]*) = sdk\.\1;$/u.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined)
			.sort();

		expect(forwardedExports).toEqual(Object.keys(pluginSdk).sort());
	});
});

describe("vetta-host ui protocol", () => {
	it("forwards every public runtime export", () => {
		const forwardedExports = protocolSource
			.split(/\r?\n/u)
			.map((line) => /^export const ([A-Za-z_$][\w$]*) = ui\.\1;$/u.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined)
			.sort();

		expect(forwardedExports).toEqual(Object.keys(vettaUi).sort());
	});
});
