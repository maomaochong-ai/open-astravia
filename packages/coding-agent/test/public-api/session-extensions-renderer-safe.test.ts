import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
const entry = resolve(sourceRoot, "public-api/session-extensions.ts");

// 这两个根入口会连带加载全部 Provider（含 AWS SDK 等 Node 专用依赖），渲染进程打包会失败。
const PROVIDER_LOADING_ENTRIES = new Set(["@vetta/ai", "@vetta/runtime-core"]);

const MODULE_REFERENCE = /^(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s+"([^"]+)";/gms;

function isTypeOnly(typeKeyword: string | undefined, clause: string): boolean {
	if (typeKeyword) return true;
	const named = clause.match(/^\{([^}]*)\}$/s);
	if (!named) return false;
	const names = named[1]
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	return names.length > 0 && names.every((name) => name.startsWith("type "));
}

function valueSpecifiers(source: string): string[] {
	return [...source.matchAll(MODULE_REFERENCE)]
		.filter(([, typeKeyword, clause]) => !isTypeOnly(typeKeyword, clause.trim()))
		.map(([, , , specifier]) => specifier);
}

function resolveRelative(from: string, specifier: string): string | undefined {
	const candidate = resolve(dirname(from), specifier.replace(/\.js$/, ".ts"));
	if (existsSync(candidate)) return candidate;
	const tsx = candidate.replace(/\.ts$/, ".tsx");
	return existsSync(tsx) ? tsx : undefined;
}

function providerLoadingImports(): string[] {
	const offenders: string[] = [];
	const visited = new Set<string>();
	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop() as string;
		if (visited.has(file)) continue;
		visited.add(file);
		for (const specifier of valueSpecifiers(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) {
				const next = resolveRelative(file, specifier);
				if (next) pending.push(next);
			} else if (PROVIDER_LOADING_ENTRIES.has(specifier)) {
				offenders.push(`${file.slice(sourceRoot.length)} -> ${specifier}`);
			}
		}
	}
	return offenders;
}

describe("session-extensions public entry", () => {
	it("stays loadable in the desktop renderer without pulling provider implementations", () => {
		expect(providerLoadingImports()).toEqual([]);
	});
});
