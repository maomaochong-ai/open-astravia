/**
 * 设计的依赖清单（ADR-0068）。
 *
 * 三条不变量，坏掉都不会当场报错、只会以别的面貌出现：清单要跟引擎同版本（否则装
 * 第三方库时 peer 校验开始乱报）、读取要吃得下坏内容（否则一个手改坏的 package.json
 * 会让整份设计的机检挂掉）、补装判据要认「声明了但没装」这一个状态（否则每次打开
 * 都白跑一次 npm，或者导入的设计永远装不上）。
 */
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { expect, it } from "vitest";
import enginePackageJson from "../engine/package.json";
import { designPackageJson, needsDependencyInstall, readDesignDependencies } from "../src/vetd/design-package";

/** 只实现被测路径用到的那几个方法；其余留空，用到了就该在测试里显式暴露出来。 */
function fakeFs(files: Record<string, string>, dirs: string[] = []): PluginFsApi {
	return {
		readFile: async (path: string) => {
			const content = files[path];
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return { content };
		},
		stat: async (path: string) =>
			dirs.includes(path) ? ({ isDirectory: true } as never) : path in files ? ({ isDirectory: false } as never) : null,
	} as unknown as PluginFsApi;
}

it("pins the react trio to the engine's own versions", () => {
	const parsed = JSON.parse(designPackageJson("login-app")) as {
		name: string;
		dependencies: Record<string, string>;
	};
	expect(parsed.name).toBe("login-app");
	for (const name of ["react", "react-dom", "react-router"]) {
		expect(parsed.dependencies[name]).toBe(enginePackageJson.dependencies[name as "react"]);
	}
	// lucide-react 由引擎 alias 接住，不该出现在用户设计的依赖清单里
	expect(parsed.dependencies["lucide-react"]).toBeUndefined();
});

it("reads declared dependencies, and survives a missing or broken manifest", async () => {
	const declared = await readDesignDependencies(
		fakeFs({ "/proj/a.vetd/package.json": JSON.stringify({ dependencies: { react: "19.1.1", recharts: "^3" } }) }),
		"/proj/a.vetd",
	);
	expect(declared).toEqual(["react", "recharts"]);

	// 老设计没有清单
	expect(await readDesignDependencies(fakeFs({}), "/proj/a.vetd")).toEqual([]);
	// 手改坏了：机检退回「只有引擎内置」，不能整条链路抛出去
	expect(await readDesignDependencies(fakeFs({ "/proj/a.vetd/package.json": "{ not json" }), "/proj/a.vetd")).toEqual(
		[],
	);
	// dependencies 不是对象
	expect(
		await readDesignDependencies(fakeFs({ "/proj/a.vetd/package.json": '{"dependencies":42}' }), "/proj/a.vetd"),
	).toEqual([]);
});

it("installs only when something is declared but node_modules is absent", async () => {
	const manifest = JSON.stringify({ dependencies: { react: "19.1.1" } });

	// 刚从 .vetdz 导入：声明在、依赖没装
	expect(await needsDependencyInstall(fakeFs({ "/d.vetd/package.json": manifest }), "/d.vetd")).toBe(true);

	// 已经装过：不该每次打开都跑一次 npm
	expect(
		await needsDependencyInstall(fakeFs({ "/d.vetd/package.json": manifest }, ["/d.vetd/node_modules"]), "/d.vetd"),
	).toBe(false);

	// 老设计没有清单：没什么可装的
	expect(await needsDependencyInstall(fakeFs({}), "/d.vetd")).toBe(false);

	// 清单里一个依赖都没有：同样不该跑
	expect(
		await needsDependencyInstall(fakeFs({ "/d.vetd/package.json": '{"dependencies":{}}' }), "/d.vetd"),
	).toBe(false);
});
