import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackSshConnection, formatLoopbackProjectUri } from "@vetta/ssh-transport/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = createLoopbackSshConnection();
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const service = await import("./filesystem-service.js");

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

describe("远程项目的文件树：用户在面板里的一串常见操作", () => {
	let remoteRoot: string;
	let root: string;

	beforeEach(() => {
		remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-tree-")));
		mkdirSync(join(remoteRoot, "src"));
		mkdirSync(join(remoteRoot, "node_modules/pkg"), { recursive: true });
		writeFileSync(join(remoteRoot, "src/main.ts"), "export {};\n");
		writeFileSync(join(remoteRoot, "node_modules/pkg/index.js"), "");
		writeFileSync(join(remoteRoot, "logo.png"), PNG_1X1);
		writeFileSync(join(remoteRoot, "LICENSE"), "MIT\n");
		root = formatLoopbackProjectUri("build-01", remoteRoot);
		service.allowProjectRoot(root);
	});

	it("新建、改名、移动、删除都发生在远端", async () => {
		const created = await service.createFilesystemEntry(`${root}/src`, "notes.md", "file");
		expect(created.path).toBe(`${root}/src/notes.md`);
		expect(existsSync(join(remoteRoot, "src/notes.md"))).toBe(true);
		await expect(service.createFilesystemEntry(`${root}/src`, "notes.md", "file")).rejects.toThrow(/EXISTS/);

		await service.renameFilesystemPath(`${root}/src/notes.md`, `${root}/src/todo.md`);
		expect(existsSync(join(remoteRoot, "src/todo.md"))).toBe(true);

		await service.createFilesystemEntry(root, "docs", "directory");
		await service.moveFilesystemPath(`${root}/src/todo.md`, `${root}/docs`);
		expect(existsSync(join(remoteRoot, "docs/todo.md"))).toBe(true);

		await service.deleteFilesystemPath(`${root}/docs`);
		expect(existsSync(join(remoteRoot, "docs"))).toBe(false);
	}, 20_000);

	it("无扩展名的文本、图片都能预览，呈现判断与本地项目同一套", async () => {
		await expect(service.readTextPreviewFile(`${root}/LICENSE`)).resolves.toMatchObject({
			status: "text",
			content: "MIT\n",
		});
		await expect(service.readTextPreviewFile(`${root}/logo.png`)).resolves.toMatchObject({ status: "binary" });
		await expect(service.readFilesystemFile(`${root}/logo.png`)).resolves.toEqual({
			content: PNG_1X1.toString("base64"),
			encoding: "base64",
		});
		await expect(service.readFilesystemBinaryFile(`${root}/logo.png`)).resolves.toMatchObject({
			mimeType: "image/png",
			size: PNG_1X1.byteLength,
		});
	});

	it("@ 选文件用的递归列举给出远端文件，跳过依赖目录", async () => {
		const files = await service.listFilesystemFilesRecursive(root);
		expect(files.map((file) => file.relPath).sort()).toEqual(["LICENSE", "logo.png", "src/main.ts"]);
		expect(files.find((file) => file.relPath === "src/main.ts")?.path).toBe(`${root}/src/main.ts`);
	});

	it("写文件保留远端文件原有的可执行位", async () => {
		writeFileSync(join(remoteRoot, "run.sh"), "old");
		chmodSync(join(remoteRoot, "run.sh"), 0o755);
		await service.writeFilesystemFile(`${root}/run.sh`, "new");
		expect(readFileSync(join(remoteRoot, "run.sh"), "utf8")).toBe("new");
		// Windows does not expose POSIX executable bits through node:fs stat.
		if (process.platform !== "win32") expect(statSync(join(remoteRoot, "run.sh")).mode & 0o777).toBe(0o755);
	});

	it("插件文件能力用的授权检查认得远程路径：项目内放行，项目外拒绝", async () => {
		await expect(service.assertFilesystemRealPathWithinProject(`${root}/.git/MERGE_MSG`)).resolves.toBeUndefined();
		await expect(service.assertFilesystemRealPathWithinProject("ssh://build-01/etc/passwd")).rejects.toThrow(
			/outside any known project/,
		);
	});

	it("项目之外、靠 .. 绕出去、或项目根本身，一律不许动", async () => {
		await expect(service.deleteFilesystemPath(root)).rejects.toThrow(/project root/);
		await expect(service.deleteFilesystemPath(`${root}/../outside`)).rejects.toThrow(/outside any known project/);
		await expect(service.readFilesystemFile("ssh://build-01/etc/passwd")).rejects.toThrow(
			/outside any known project/,
		);
		expect(existsSync(remoteRoot)).toBe(true);
	});
});
