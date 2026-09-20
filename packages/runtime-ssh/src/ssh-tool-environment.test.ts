import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import { SshConnection, type SshHost, type SshProcessResult, type SshProcessRunner } from "@vetta/ssh-transport";
import { describe, expect, it } from "vitest";
import { createSshCodingToolEnvironment } from "./ssh-tool-environment.js";

const host: SshHost = { id: "build-01", label: "构建机", target: "build", source: "manual" };
const REMOTE_CWD = "/srv/app";

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/**
 * 一台只认识几条命令的假远端。
 *
 * 用真实的 SshConnection 配假进程执行器，而不是直接伪造 SshConnection：这样命令
 * 构造、引用和输出解析都在被测路径里，测试才能证明「工具确实作用在远端」而不是
 * 「我们调用了自己写的 mock」。
 */
function createFakeHost(files: Map<string, string>, binaryFiles = new Map<string, Uint8Array>()) {
	const commands: string[] = [];
	const runner: SshProcessRunner = {
		run: async (invocation): Promise<SshProcessResult> => {
			const remoteCommand = String(invocation.argv[invocation.argv.length - 1]);
			commands.push(remoteCommand);
			const ok = (stdout: string): SshProcessResult => ({
				exitCode: 0,
				stdout: encode(stdout),
				stderr: "",
				aborted: false,
			});

			if (remoteCommand.includes("uname")) return ok("Linux\nx86_64\n");

			if (remoteCommand.includes("HOME")) return ok("/home/dev");

			const head = /^head -c \d+ -- '(.+)'$/.exec(remoteCommand);
			if (head) {
				const bytes = binaryFiles.get(head[1]);
				return bytes ? { ...ok(""), stdout: bytes } : ok(files.get(head[1]) ?? "");
			}

			const cat = /^cat -- '(.+)'$/.exec(remoteCommand);
			if (cat && binaryFiles.has(cat[1])) return { ...ok(""), stdout: binaryFiles.get(cat[1]) as Uint8Array };
			if (cat) {
				const content = files.get(cat[1]);
				if (content === undefined) {
					return { exitCode: 1, stdout: new Uint8Array(), stderr: "cat: No such file", aborted: false };
				}
				return ok(content);
			}

			// 写文件是唯一带 stdin 的操作；目标路径是脚本里的第一个赋值。
			if (invocation.stdin !== undefined) {
				const target = /p='\\''(.+?)'\\''\n/.exec(remoteCommand)?.[1];
				if (target === undefined) throw new Error(`unrecognised write command: ${remoteCommand}`);
				files.set(target, new TextDecoder().decode(invocation.stdin));
				return ok("");
			}

			if (remoteCommand.startsWith("[ -e ")) {
				const target = /^\[ -e '(.+?)' \]/.exec(remoteCommand)?.[1] ?? "";
				if (binaryFiles.has(target))
					return ok(`regular file\t${binaryFiles.get(target)?.byteLength}\t1700000000\t${target}\n`);
				if (files.has(target)) return ok(`regular file\t${files.get(target)?.length}\t1700000000\t${target}\n`);
				const isDirectory = [...files.keys()].some((path) => path.startsWith(`${target}/`));
				return ok(isDirectory ? `directory\t4096\t1700000000\t${target}\n` : "");
			}

			if (remoteCommand.startsWith("cd ") && remoteCommand.includes("find .")) {
				const directory = /^cd '(.+?)'/.exec(remoteCommand)?.[1] ?? "";
				const names = new Set<string>();
				for (const path of files.keys()) {
					if (!path.startsWith(`${directory}/`)) continue;
					names.add(path.slice(directory.length + 1).split("/")[0]);
				}
				return ok([...names].map((name) => `regular file\t1\t1700000000\t./${name}`).join("\n"));
			}

			// 其余当作用户命令（bash 工具）。
			if (remoteCommand.includes("sleep 999")) {
				invocation.onStdout?.(encode("partial output\n"));
				return { exitCode: null, stdout: new Uint8Array(), stderr: "", aborted: true, timedOut: true };
			}
			return ok("remote command ran\n");
		},
	};
	return {
		commands,
		connection: new SshConnection(host, { runner, controlPath: "/tmp/cp" }),
	};
}

function toolByName(registrations: readonly CodingToolRegistration[], name: string) {
	const registration = registrations.find((item) => item.tool.name === name);
	if (!registration) throw new Error(`tool not registered: ${name}`);
	return registration.tool;
}

function execute(tool: ReturnType<typeof toolByName>, input: Record<string, unknown>): Promise<RuntimeToolResult> {
	return tool.execute({
		sessionId: "s",
		turnId: "t",
		toolCallId: "c",
		input,
		signal: new AbortController().signal,
	} as never);
}

function createEnvironment(files: Map<string, string>, binaryFiles?: Map<string, Uint8Array>) {
	const fake = createFakeHost(files, binaryFiles);
	const environment = createSshCodingToolEnvironment({
		connection: fake.connection,
		remoteCwd: REMOTE_CWD,
		editPathPolicy: { getRejectionReason: () => undefined },
		writePathPolicy: { getRejectionReason: () => undefined },
	});
	return { ...fake, environment };
}

function textOf(result: RuntimeToolResult): string {
	return result.content
		.map((item) => (item.type === "text" ? item.text : ""))
		.join("")
		.trim();
}

describe("远程项目的 Agent 工具", () => {
	it("read 读到的是远端文件内容", async () => {
		const files = new Map([["/srv/app/main.ts", "export const answer = 42;\n"]]);
		const { environment } = createEnvironment(files);

		const result = await execute(toolByName(environment.registrations, "read"), { path: "main.ts" });

		expect(textOf(result)).toContain("export const answer = 42;");
	});

	it("write 写到远端，内容随即能被 read 读回", async () => {
		const files = new Map<string, string>();
		const { environment } = createEnvironment(files);

		await execute(toolByName(environment.registrations, "write"), {
			path: "notes.md",
			content: "# 远端\n",
		});

		expect(files.get("/srv/app/notes.md")).toBe("# 远端\n");
	});

	it("edit 在远端完成读—改—写，不落本地", async () => {
		const files = new Map([["/srv/app/main.ts", "const port = 3000;\n"]]);
		const { environment } = createEnvironment(files);

		await execute(toolByName(environment.registrations, "edit"), {
			path: "main.ts",
			oldText: "3000",
			newText: "8080",
		});

		expect(files.get("/srv/app/main.ts")).toBe("const port = 8080;\n");
	});

	it("ls 列的是远端目录", async () => {
		const files = new Map([
			["/srv/app/main.ts", "x"],
			["/srv/app/readme.md", "y"],
		]);
		const { environment } = createEnvironment(files);

		const result = await execute(toolByName(environment.registrations, "ls"), { path: "." });

		expect(textOf(result)).toContain("main.ts");
		expect(textOf(result)).toContain("readme.md");
	});

	it("bash 在远端的项目目录里执行，且不透传本机环境变量", async () => {
		const { environment, commands } = createEnvironment(new Map());

		await execute(toolByName(environment.registrations, "bash"), { command: "npm test" });

		const userCommand = commands.find((command) => command.includes("npm test"));
		expect(userCommand).toBeDefined();
		// 登录 shell：nvm/pyenv 只在 profile 里改 PATH，非交互 shell 读不到。
		expect(userCommand).toContain("-l -c");
		// 整段脚本会作为 -c 的单个参数再引用一层，所以这里看到的是二次转义后的形式。
		expect(userCommand).toContain("cd '\\''/srv/app'\\''");
		// 本机的 PATH、代理和凭据不该出现在远端命令里。
		expect(userCommand).not.toContain("export PATH=");
	});

	it("~ 指的是远端的家目录，不是本机的", async () => {
		const files = new Map<string, string>();
		const { environment } = createEnvironment(files);

		await execute(toolByName(environment.registrations, "write"), { path: "~/notes.md", content: "hi" });

		expect([...files.keys()]).toEqual(["/home/dev/notes.md"]);
	});

	it("read 能把远端的图片交给模型看，而不是当成二进制文件拒掉", async () => {
		const png = Uint8Array.from(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
				"base64",
			),
		);
		const { environment } = createEnvironment(new Map(), new Map([["/srv/app/logo.png", png]]));

		const result = await execute(toolByName(environment.registrations, "read"), { path: "logo.png" });

		expect(result.content.some((item) => item.type === "image")).toBe(true);
	});

	it("bash 超时后告诉模型超时了多久，并保留已经产生的输出", async () => {
		const { environment } = createEnvironment(new Map());

		const error = await execute(toolByName(environment.registrations, "bash"), {
			command: "sleep 999",
			timeout: 5,
		}).catch((e: unknown) => e);

		expect(String((error as Error).message)).toContain("partial output");
		expect(String((error as Error).message)).toContain("timed out after 5 seconds");
	});

	it("不注册会去搜本机磁盘的搜索工具", async () => {
		// grep/glob/find/tree 内部直接 spawn 本机 ripgrep。注册进远程会话就会把本机的
		// 命中当成远端项目的内容交给模型——正是执行边界要禁止的静默回退。
		const { environment } = createEnvironment(new Map());

		const names = environment.registrations.map((registration) => registration.tool.name);
		expect(names).toEqual(["read", "edit", "write", "ls", "bash"]);
	});
});
