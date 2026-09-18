/**
 * 入口体积合同（性能）：App 启动时宿主会整包求值插件入口 chunk。大件 UI 面
 * （画布 / 画廊 / 导出 / 预览 / 截图卡）与 400KB 的 history runner 源码必须保持
 * 懒加载——谁被静态 import 回入口，谁就回到「启动即求值」的老路（入口曾因此到
 * 836KB，低配机上直接拖慢插件宿主就绪与冷启动首轮发送）。
 *
 * 用源码 import 图断言而不是渲染断言：求值时机是构建期结构，静态检查即可证明。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** 提取一个模块的静态 import 说明符（不含 import() 动态导入与纯类型导入）。 */
function staticImports(absPath: string): string[] {
	const source = readFileSync(absPath, "utf8");
	const specifiers: string[] = [];
	const pattern = /^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gms;
	for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
	// 副作用导入（import "./style.css"）也算静态。
	for (const match of source.matchAll(/^import\s+["']([^"']+)["']/gm)) specifiers.push(match[1]);
	return specifiers;
}

const ENTRY_DYNAMIC = [
	"./canvas/CanvasTab",
	"./mockup/ExportMockupDialog",
	"./preview/VetdPreview",
	"./cards/ScreenshotCard",
];
const HEAVY_NOT_STATIC = [...ENTRY_DYNAMIC, "./gallery/GalleryView"];

describe("插件入口懒加载合同", () => {
	it("入口不静态 import 任何大件 UI 面组件", () => {
		const imports = staticImports(join(srcDir, "index.tsx"));
		for (const heavy of HEAVY_NOT_STATIC) {
			expect(imports, `${heavy} 必须走动态 import`).not.toContain(heavy);
		}
	});

	it("入口对大件 UI 面保留动态 import（懒加载真的存在，而不是被删掉了）", () => {
		const source = readFileSync(join(srcDir, "index.tsx"), "utf8");
		for (const heavy of ENTRY_DYNAMIC) {
			expect(source).toContain(`import("${heavy}")`);
		}
	});

	it("画廊工作区注册同步薄壳，GalleryView 仍动态 import", () => {
		expect(staticImports(join(srcDir, "index.tsx"))).toContain("./gallery/GalleryRoute");
		const routePath = join(srcDir, "gallery", "GalleryRoute.tsx");
		expect(staticImports(routePath)).toContain("./GalleryHeroShell");
		expect(staticImports(routePath)).not.toContain("./after-first-paint");
		expect(staticImports(routePath)).not.toContain("./GalleryView");
		const routeSource = readFileSync(routePath, "utf8");
		expect(routeSource).toContain('import("./GalleryView")');
		expect(routeSource).not.toContain("useAfterFirstPaint");
		expect(routeSource).not.toMatch(/\blazy\s*\(/);
		const heroPath = join(srcDir, "gallery", "GalleryHeroShell.tsx");
		expect(staticImports(heroPath)).not.toContain("./GalleryView");
		expect(staticImports(heroPath)).not.toContain("./DesignSystemGrid");
		const heroSource = readFileSync(heroPath, "utf8");
		expect(heroSource).toContain('import("./GalleryView")');
		expect(heroSource).toContain('import("./DesignSystemGrid")');
	});

	it("runner 源码 (?raw) 不被 runner-host 静态内嵌", () => {
		const imports = staticImports(join(srcDir, "history/runner-host.ts"));
		const rawImports = imports.filter((specifier) => specifier.includes("?raw"));
		expect(rawImports).toEqual([]);
		const source = readFileSync(join(srcDir, "history/runner-host.ts"), "utf8");
		expect(source).toContain('import("../../history-runner/dist/runner.mjs?raw")');
	});

	it("入口通过调度模块预取画廊面，调度模块本身不静态打包画廊", () => {
		expect(staticImports(join(srcDir, "index.tsx"))).toContain("./gallery/prefetch-gallery-surface");
		const prefetchPath = join(srcDir, "gallery", "prefetch-gallery-surface.ts");
		expect(staticImports(prefetchPath)).not.toContain("./GalleryView");
		expect(staticImports(prefetchPath)).not.toContain("./gallery-store");
		expect(readFileSync(prefetchPath, "utf8")).toContain('import("./GalleryView")');
		expect(readFileSync(prefetchPath, "utf8")).toContain('import("./DesignSystemGrid")');
		expect(readFileSync(prefetchPath, "utf8")).toContain("skipCovers: true");
	});

	it("GalleryView 不静态解析风格墙，避免挡住 Hero 首画", () => {
		const galleryView = join(srcDir, "gallery", "GalleryView.tsx");
		expect(staticImports(galleryView)).not.toContain("./DesignSystemGrid");
		expect(readFileSync(galleryView, "utf8")).toContain('import("./DesignSystemGrid")');
	});

	it("GalleryView 不静态拉导出/建项/打开项目，点到再动态 import", () => {
		const galleryView = join(srcDir, "gallery", "GalleryView.tsx");
		expect(staticImports(galleryView)).not.toContain("./gallery-actions");
		expect(staticImports(galleryView)).not.toContain("./start-from-system");
		expect(staticImports(galleryView)).not.toContain("./open-project");
		expect(staticImports(galleryView)).not.toContain("./AllProjectsView");
		expect(staticImports(galleryView)).not.toContain("./CreateDesignDialog");
		const source = readFileSync(galleryView, "utf8");
		expect(source).toContain('import("./gallery-actions")');
		expect(source).toContain('import("./open-project")');
		expect(source).toContain('import("./start-from-system")');
	});

	it("守住回归入口的间接路径：入口静态可达图不包含大件 UI 面模块", () => {
		// 从 index.tsx 做静态 import 闭包遍历（仅项目内相对模块），
		// 大件 UI 面不允许经由任何中间模块被静态拉回入口 chunk。
		const visited = new Set<string>();
		const queue = [join(srcDir, "index.tsx")];
		const heavyResolved = new Set(
			HEAVY_NOT_STATIC.map((specifier) => resolve(srcDir, `${specifier.slice(2)}.tsx`)),
		);
		while (queue.length > 0) {
			const current = queue.pop() as string;
			if (visited.has(current)) continue;
			visited.add(current);
			for (const specifier of staticImports(current)) {
				if (!specifier.startsWith(".") || specifier.includes("?")) continue;
				const base = resolve(dirname(current), specifier);
				for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
					try {
						readFileSync(candidate);
						expect(heavyResolved.has(candidate), `${specifier}（经 ${current}）不得静态可达`).toBe(false);
						queue.push(candidate);
						break;
					} catch {
						// 不是这个扩展名，试下一个。
					}
				}
			}
		}
		expect(visited.size).toBeGreaterThan(3);
	});
});
