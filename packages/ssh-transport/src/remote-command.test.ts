import { describe, expect, it } from "vitest";
import {
	buildListDirectoryCommand,
	buildRemoteCommand,
	buildRemoteScript,
	buildStatCommand,
	quoteShellArgument,
} from "./remote-command.js";

describe("quoteShellArgument", () => {
	it("中和掉远端 shell 会解释的每一类元字符", () => {
		// 路径来自用户选目录、模型给的参数和远端目录列表，任何一类漏掉都是任意命令执行。
		const cases = [
			"$(whoami)",
			"`id`",
			"a; rm -rf /",
			"a && rm -rf /",
			"a | tee /tmp/x",
			"a > /tmp/x",
			"$HOME",
			"a\nrm -rf /",
			"*",
			"~/secret",
			"a\\b",
		];
		for (const value of cases) {
			expect(quoteShellArgument(value)).toBe(`'${value}'`);
		}
	});

	it("用闭合再重开的方式处理单引号，引号逃不出字面量", () => {
		expect(quoteShellArgument("it's")).toBe("'it'\\''s'");
		// 经典逃逸尝试：靠一个单引号结束引用，后面接命令。
		expect(quoteShellArgument("'; rm -rf / #")).toBe("''\\''; rm -rf / #'");
	});

	it("保留空串与空白", () => {
		expect(quoteShellArgument("")).toBe("''");
		expect(quoteShellArgument("a b")).toBe("'a b'");
	});
});

describe("buildRemoteCommand", () => {
	it("走登录 shell，让 nvm、pyenv 这类只改 profile 的 PATH 生效", () => {
		// 用正则而不是字面量：`${…}` 写在普通字符串里会被 lint 当成写漏的模板串。
		expect(buildRemoteCommand("node -v")).toMatch(/^exec "\$\{SHELL:-\/bin\/sh}" -l -c /);
	});

	it("整段脚本作为 -c 的单个参数被引用，&& 不会落到外层", () => {
		// 直接把 `cd x && cmd` 摊在 -c 外面，cmd 就跑在了家目录而不是项目里。
		expect(buildRemoteCommand("npm test", { cwd: "/srv/app" })).toBe(
			`exec "\${SHELL:-/bin/sh}" -l -c 'cd '\\''/srv/app'\\'' && npm test'`,
		);
	});
});

describe("buildRemoteScript", () => {
	it("cd 用 && 连接，目录不存在就整条失败而不是落到家目录执行", () => {
		expect(buildRemoteScript("npm test", { cwd: "/srv/app" })).toBe("cd '/srv/app' && npm test");
	});

	it("工作目录里的引号不会把命令截断", () => {
		expect(buildRemoteScript("ls", { cwd: "/srv/it's here" })).toBe("cd '/srv/it'\\''s here' && ls");
	});

	it("环境变量值被引用，变量名非法时拒绝构造", () => {
		expect(buildRemoteScript("go build", { env: { GOFLAGS: "-tags 'a b'" } })).toBe(
			"export GOFLAGS='-tags '\\''a b'\\''' && go build",
		);
		expect(() => buildRemoteScript("ls", { env: { "A;B": "x" } })).toThrow("Invalid environment variable name");
	});
});

describe("buildListDirectoryCommand", () => {
	it("按远端 stat 方言选格式，不在远端用 || 试错", () => {
		// 试错会在第一条命令部分成功时给出半截输出，解析不出来也发现不了。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("--printf=");
		expect(buildListDirectoryCommand("/srv", "bsd")).toContain("-f ");
		expect(buildListDirectoryCommand("/srv", "gnu")).not.toContain("||");
	});

	it("目录路径被引用", () => {
		expect(buildListDirectoryCommand("/srv/a b", "gnu")).toContain("cd '/srv/a b'");
	});

	it("锁死 C locale，否则中文系统上 stat 会输出「目录」而不是 directory", () => {
		// 现场故障：远端是中文 locale，每个条目都被判成未知类型，目录列表显示为空，
		// 而且没有任何报错——从现象完全反推不到原因。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("LC_ALL=C");
		expect(buildStatCommand("/srv/app", "gnu")).toContain("LC_ALL=C");
	});

	it("用 env 设置 locale，而不是 POSIX 的前缀赋值", () => {
		// `LC_ALL=C cmd` 是 POSIX shell 语法，远端登录 shell 若是 fish 就会报错；
		// `env` 在任何 shell 里都只是一个普通命令。
		expect(buildListDirectoryCommand("/srv", "gnu")).toContain("env LC_ALL=C");
	});
});
