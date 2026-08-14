import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_RUNTIME_NAME } from "./app-identity.js";

const packageRoot = join(import.meta.dirname, "..", "..");

function readPackageSource(relativePath: string): string {
	return readFileSync(join(packageRoot, relativePath), "utf8");
}

describe("app runtime name", () => {
	// 打包版的 app 名字来自 asar 内写入的 package.json，开发态由 main.ts 覆盖。
	// 两者一旦分叉，safeStorage 就会在开发与打包环境派生出不同的主密钥，
	// 共享 ~/.vetta 时表现为“API key 丢失”，且互相覆盖对方的密文。
	it("matches the name written into the packaged app package.json", () => {
		const preparePack = readPackageSource("scripts/prepare-pack.js");
		const appPkgName = /const appPkg = \{[^}]*?\bname:\s*"([^"]+)"/s.exec(preparePack)?.[1];
		expect(appPkgName).toBe(APP_RUNTIME_NAME);
	});

	it("is applied to app.name unconditionally in the main process", () => {
		const mainSource = readPackageSource("src/main/main.ts");
		expect(mainSource).toContain("app.name = APP_RUNTIME_NAME;");
		// 早期实现只在开发态覆盖名字，正是环境间密钥分叉的成因。
		expect(mainSource).not.toMatch(/app\.name\s*=\s*"/);
	});
});
