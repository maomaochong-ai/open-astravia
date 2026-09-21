import { describe, expect, it } from "vitest";
import { resolveLocalFilePath } from "./resolve-local-file-path";
import { isSubPath, pathBasename, pathDirname, pathJoin, pathNormalize } from "./utils";

describe("渲染层路径工具不破坏远程项目的 URI", () => {
	it("规范化只作用在远端路径上，归属前缀的 // 原样保留", () => {
		// 回归：按 / 切分再拼回去会得到 `ssh:/h1/...`，主进程随即认不出它是远程路径。
		expect(pathNormalize("ssh://h1/srv/app/./src/../lib/a.ts")).toBe("ssh://h1/srv/app/lib/a.ts");
		expect(pathNormalize("ssh://h1/srv//app/")).toBe("ssh://h1/srv/app");
	});

	it("dirname 在远端根目录停住，basename 取远端文件名", () => {
		expect(pathDirname("ssh://h1/srv/app/a.ts")).toBe("ssh://h1/srv/app");
		expect(pathDirname("ssh://h1/file")).toBe("ssh://h1/");
		expect(pathBasename("ssh://h1/srv/app")).toBe("app");
		expect(pathBasename("ssh://h1/")).toBe("h1");
	});

	it("join 与 isSubPath 照常工作", () => {
		expect(pathJoin("ssh://h1/srv/app", "src")).toBe("ssh://h1/srv/app/src");
		expect(isSubPath("ssh://h1/srv/app/src/a.ts", "ssh://h1/srv/app")).toBe(true);
		expect(isSubPath("ssh://h2/srv/app/src/a.ts", "ssh://h1/srv/app")).toBe(false);
	});

	it("本地路径的行为不变", () => {
		expect(pathNormalize("/work/./app/../lib")).toBe("/work/lib");
		expect(pathDirname("/work/app/a.ts")).toBe("/work/app");
		expect(pathDirname("C:\\work\\a.ts")).toBe("C:\\work");
	});
});

describe("点击消息里的文件路径", () => {
	const project = "ssh://h1/srv/app";

	it("远程项目里的相对路径落到远端项目之下", () => {
		expect(resolveLocalFilePath("src/a.ts", project)).toBe("ssh://h1/srv/app/src/a.ts");
		expect(resolveLocalFilePath("./docs/../README.md", project)).toBe("ssh://h1/srv/app/README.md");
	});

	it("工具回传的远端绝对路径换回项目 URI，而不是被当成本机路径", () => {
		expect(resolveLocalFilePath("/srv/app/src/a.ts", project)).toBe("ssh://h1/srv/app/src/a.ts");
	});

	it("项目之外的绝对路径保持原样——宿主给出的本机路径也长这样", () => {
		expect(resolveLocalFilePath("/Users/me/.vetta/image-cache/s1/a.png", project)).toBe(
			"/Users/me/.vetta/image-cache/s1/a.png",
		);
		// 只是前缀相同的兄弟目录不算在项目之下。
		expect(resolveLocalFilePath("/srv/app-secrets/key", project)).toBe("/srv/app-secrets/key");
	});

	it("本地项目照旧", () => {
		expect(resolveLocalFilePath("src/a.ts", "/work/app")).toBe("/work/app/src/a.ts");
		expect(resolveLocalFilePath("/etc/hosts", "/work/app")).toBe("/etc/hosts");
	});
});
