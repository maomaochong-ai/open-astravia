/**
 * 引擎依赖靠 `npm ci` 安装（engine-manager 的 installDependencies），而 `npm ci`
 * 在 lock 与 package.json 不同源时会直接失败——失败点在用户机器上、装依赖那一刻，
 * 画布只会显示一句安装退出码。所以把漂移挡在这里：改了 engine/package.json 就必须
 * 在 engine/ 下重新生成 package-lock.json。
 */
import { describe, expect, it } from "vitest";
import enginePackageJson from "../engine/package.json";
import engineLock from "../engine/package-lock.json";
import { ENGINE_FILES } from "../src/engine/engine-files";

const rootEntry = engineLock.packages[""] as {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

describe("design engine lockfile", () => {
	it("ships with the materialized engine template", () => {
		expect(Object.keys(ENGINE_FILES)).toContain("package-lock.json");
		expect(ENGINE_FILES["package-lock.json"]).toContain('"lockfileVersion"');
	});

	it("uses a lockfile version the managed npm can consume with `npm ci`", () => {
		expect(engineLock.lockfileVersion).toBeGreaterThanOrEqual(2);
	});

	it("declares the same package identity as engine/package.json", () => {
		expect(rootEntry.name).toBe(enginePackageJson.name);
		expect(rootEntry.version).toBe(enginePackageJson.version);
	});

	it("pins exactly the ranges engine/package.json declares", () => {
		expect(rootEntry.dependencies ?? {}).toEqual(enginePackageJson.dependencies);
		expect(rootEntry.devDependencies ?? {}).toEqual(enginePackageJson.devDependencies);
	});

	it("resolves every declared dependency to a concrete version", () => {
		const declared = [
			...Object.keys(enginePackageJson.dependencies),
			...Object.keys(enginePackageJson.devDependencies),
		];
		const missing = declared.filter((name) => !(`node_modules/${name}` in engineLock.packages));
		expect(missing).toEqual([]);
	});
});
