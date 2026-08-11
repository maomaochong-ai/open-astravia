import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPackageManifest(relativePath: string): Readonly<Record<string, unknown>> {
	const parsed: unknown = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
	if (typeof parsed !== "object" || parsed === null) throw new Error(`Invalid package manifest: ${relativePath}`);
	return parsed as Readonly<Record<string, unknown>>;
}

describe("canonical executable ownership", () => {
	it("publishes every Agent executable from cli-app", () => {
		const cliApp = readPackageManifest("../package.json");
		const codingAgent = readPackageManifest("../../coding-agent/package.json");

		expect(cliApp.bin).toEqual({
			vetta: "dist/cli.js",
			"vetta-agent": "dist/agent-cli.js",
			"vetta-cli-app": "dist/cli.js",
			"vetta-agent-rpc": "dist/agent-rpc-cli.js",
		});
		expect(codingAgent.bin).toBeUndefined();
	});
});
