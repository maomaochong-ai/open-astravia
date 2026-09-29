import { describe, expect, it } from "vitest";
import {
	makeTargetCommand,
	packageScriptCommand,
	parseMakefileTargets,
	parsePackageJson,
	quoteShellWord,
} from "../src/scripts/parse";

describe("parsePackageJson", () => {
	it("按文件顺序取出字符串脚本，识别 packageManager 字段", () => {
		const info = parsePackageJson(
			JSON.stringify({
				name: "@acme/web",
				packageManager: "pnpm@9.1.0",
				scripts: { dev: "vite", build: "vite build", broken: 1 },
			}),
		);
		expect(info).toEqual({
			name: "@acme/web",
			packageManager: "pnpm",
			scripts: [
				{ name: "dev", body: "vite" },
				{ name: "build", body: "vite build" },
			],
		});
	});

	it("坏 JSON 与非对象返回 null，不认识的包管理器当没写", () => {
		expect(parsePackageJson("{ nope")).toBeNull();
		expect(parsePackageJson("[]")).toBeNull();
		expect(parsePackageJson(JSON.stringify({ packageManager: "deno@2" }))?.packageManager).toBeUndefined();
	});
});

describe("parseMakefileTargets", () => {
	it("收集普通目标与 ## 说明，跳过特殊目标、模式规则、变量赋值和配方行", () => {
		const text = [
			".PHONY: build test",
			"VERSION := 1.0",
			"CC = gcc",
			"export PATH := $(PATH)",
			"build: deps ## 构建产物",
			"\tgo build ./...",
			"test lint: build",
			"%.o: %.c",
			"$(BIN): main.go",
			"install:: build",
			"# comment: not a target",
			"build: ## 重复声明不覆盖已有说明",
		].join("\n");
		expect(parseMakefileTargets(text)).toEqual([
			{ name: "build", description: "构建产物" },
			{ name: "test" },
			{ name: "lint" },
			{ name: "install" },
		]);
	});

	it("续行合并后再解析", () => {
		expect(parseMakefileTargets("all: a \\\n  b\n")).toEqual([{ name: "all" }]);
	});
});

describe("命令拼装", () => {
	it("按包管理器拼 run 命令，需要时给脚本名加引号", () => {
		expect(packageScriptCommand("bun", "dev")).toBe("bun run dev");
		expect(packageScriptCommand("npm", "build:web")).toBe("npm run build:web");
		expect(packageScriptCommand("yarn", "my script")).toBe('yarn run "my script"');
		expect(quoteShellWord('a"b')).toBe('"a\\"b"');
	});

	it("Makefile 以外的文件名显式 -f", () => {
		expect(makeTargetCommand("Makefile", "test")).toBe("make test");
		expect(makeTargetCommand("GNUmakefile", "test")).toBe("make -f GNUmakefile test");
	});
});
