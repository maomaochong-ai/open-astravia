/**
 * cloud 模块边界守卫：宿主代码不得直接依赖 cloud 内部实现，
 * 否则 lite 构建（VETTA_CLOUD_ENABLED=false）的死代码消除会失效。
 *
 * 允许的接触面：
 * - renderer：`@shared/components/cloud-slots`（懒加载槽位）与 `import type`
 * - main：`cloud-bridge.ts`（运行期挂载点）、main.ts 的 `import type` + 动态 import
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname);

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules") continue;
			out.push(...listSourceFiles(full));
			continue;
		}
		if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
	}
	return out;
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

interface Violation {
	file: string;
	line: number;
	text: string;
}

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of listSourceFiles(SRC_ROOT)) {
		const rel = toPosix(relative(SRC_ROOT, file));
		const inRendererCloud = rel.startsWith("renderer/cloud/");
		const inMainCloud = rel.startsWith("main/cloud/");
		const isSlots = rel === "renderer/shared/components/cloud-slots.tsx";
		const isMainEntry = rel === "main/main.ts";
		if (inRendererCloud || inMainCloud || isSlots) continue;

		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((text, index) => {
			const trimmed = text.trim();
			// import type 不参与运行时依赖，允许（如 theme registry / main.ts 的句柄类型）
			if (trimmed.startsWith("import type ")) return;
			// renderer 宿主：禁止静态引用 @cloud/**
			if (rel.startsWith("renderer/") && /from\s+["']@cloud\//.test(trimmed)) {
				violations.push({ file: rel, line: index + 1, text: trimmed });
				return;
			}
			// main 宿主：禁止引用 cloud/ 内部（cloud-bridge 是唯一合法挂载点）
			if (rel.startsWith("main/") && /from\s+["'][./]*cloud\//.test(trimmed)) {
				violations.push({ file: rel, line: index + 1, text: trimmed });
				return;
			}
			// 动态 import 只允许 main.ts（构建期常量折叠的加载点）
			if (!isMainEntry && /import\(\s*["'][^"']*\/cloud\//.test(trimmed)) {
				violations.push({ file: rel, line: index + 1, text: trimmed });
			}
		});
	}
	return violations;
}

describe("cloud 模块边界", () => {
	it("宿主代码不直接 import cloud 内部实现", () => {
		expect(findViolations()).toEqual([]);
	});
});
