import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localToolPathHost, remotePosixToolPathHost } from "../../../src/coding/index.js";
import {
	formatNotFoundPath,
	resolveExistingPath,
	resolveToCwd,
	resolveWritablePath,
} from "../../../src/coding/shared/path-resolution.js";
import { rewriteQuotedPathLiterals } from "../../../src/coding/shared/quoted-path-correction.js";

describe("本机路径宿主（缺省）", () => {
	it("~ 展开为本机家目录，相对路径落到 cwd 下", () => {
		expect(resolveToCwd("~/notes.md", "/work")).toBe(`${homedir()}/notes.md`);
		expect(resolveToCwd("src/a.ts", "/work", localToolPathHost)).toBe(join("/work", "src/a.ts"));
	});

	it("照旧按磁盘上的真实文件名纠正弯引号写法", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-path-"));
		writeFileSync(join(dir, "it’s.md"), "x");
		expect(resolveExistingPath("it's.md", dir)).toBe(join(dir, "it’s.md"));
	});
});

describe("远端路径宿主", () => {
	it("不拿本机磁盘上碰巧存在的文件名去改写远端目标", () => {
		// 本机恰好有弯引号版本：若仍探本机，远端的读写目标会被悄悄换成这个名字。
		const dir = mkdtempSync(join(tmpdir(), "vetta-path-"));
		writeFileSync(join(dir, "it’s.md"), "x");
		expect(resolveExistingPath("it's.md", dir, remotePosixToolPathHost)).toBe(`${dir}/it's.md`);
		expect(resolveWritablePath("it's.md", dir, remotePosixToolPathHost)).toBe(`${dir}/it's.md`);
	});

	it("~ 不按本机家目录展开，也不被拼成 cwd 下名叫 ~ 的目录", () => {
		expect(resolveToCwd("~/notes.md", "/srv/app", remotePosixToolPathHost)).toBe("~/notes.md");
		expect(resolveToCwd("~", "/srv/app", remotePosixToolPathHost)).toBe("~");
	});

	it("相对路径按 POSIX 规则落到远端 cwd 下，.. 被规范化", () => {
		expect(resolveToCwd("src/../lib/a.ts", "/srv/app", remotePosixToolPathHost)).toBe("/srv/app/lib/a.ts");
		expect(resolveToCwd("/etc/hosts", "/srv/app", remotePosixToolPathHost)).toBe("/etc/hosts");
	});

	it("找不到路径时不把本机父目录里的文件名当成提示报给模型", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-path-"));
		writeFileSync(join(dir, "config.local.json"), "x");
		const message = formatNotFoundPath(`${dir}/config.json`, dir, remotePosixToolPathHost);
		expect(message).not.toContain("Similar entries");
		expect(message).toContain(`working directory is ${dir}`);
	});

	it("bash 命令里带引号的路径不按本机磁盘改写", () => {
		const dir = mkdtempSync(join(tmpdir(), "vetta-path-"));
		writeFileSync(join(dir, "it’s.md"), "x");
		const command = `cat "./it's.md"`;
		expect(rewriteQuotedPathLiterals(command, dir).pathCorrections).toHaveLength(1);
		expect(rewriteQuotedPathLiterals(command, dir, remotePosixToolPathHost)).toEqual({
			output: command,
			pathCorrections: [],
		});
	});
});
