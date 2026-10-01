import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as pluginSdk from "../../../../../packages/plugins/plugin-sdk/src/index.js";
import * as themeUiPlugin from "../../../../../packages/theme-ui/src/plugin-ui/index.js";
import * as astraviaUi from "../../../../../packages/ui/src/index.js";

const protocolSource = readFileSync(new URL("./plugin-protocol.ts", import.meta.url), "utf8");

describe("astravia-host plugin-sdk protocol", () => {
	it("forwards every public runtime export", () => {
		const forwardedExports = protocolSource
			.split(/\r?\n/u)
			.map((line) => /^export const ([A-Za-z_$][\w$]*) = sdk\.\1;$/u.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined)
			.sort();

		expect(forwardedExports).toEqual(Object.keys(pluginSdk).sort());
	});
});

describe("astravia-host ui protocol", () => {
	it("forwards every public runtime export", () => {
		const forwardedExports = protocolSource
			.split(/\r?\n/u)
			.map((line) => /^export const ([A-Za-z_$][\w$]*) = ui\.\1;$/u.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined)
			.sort();

		expect(forwardedExports).toEqual(Object.keys(astraviaUi).sort());
	});
});

describe("astravia-host theme-ui plugin protocol", () => {
	it("forwards every public runtime export", () => {
		const forwardedExports = protocolSource
			.split(/\r?\n/u)
			.map((line) => /^export const ([A-Za-z_$][\w$]*) = themeUi\.\1;$/u.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined)
			.sort();

		expect(forwardedExports).toEqual(Object.keys(themeUiPlugin).sort());
	});
});
