/**
 * 引擎分发清单的完整性。
 *
 * 回归的现场：`engine/src/bridge.ts` 改成从共用模块 `./bridge-protocol` 取信封标记，
 * 新文件本身没进 `ENGINE_FILES`。物化到 `~/.astravia/design-engine/` 的引擎于是缺
 * 那个模块，`Failed to resolve import "./bridge-protocol"` 让整个入口编译失败——
 * 画布上不是「某一帧报错」，而是每一帧都白等满 8 秒截图超时、左侧画框点不动，
 * 看起来像性能问题。
 *
 * 所以这里不测某一个文件，而测规则本身：引擎源码树里的每个文件，以及源码里每条
 * 相对 import 的落点，都必须在清单里。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ENGINE_FILES } from "../src/engine/engine-files";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = join(pluginRoot, "engine");
const engineSrc = join(engineRoot, "src");

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
}

/** `engine/` 内的相对路径（posix 分隔符），与 ENGINE_FILES 的键同域。 */
function engineRel(absPath: string): string {
	return relative(engineRoot, absPath).split("\\").join("/");
}

/** 源码里的相对 import 说明符。裸包名不归引擎分发管，交给 node_modules。 */
function relativeImportsOf(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
		specifiers.push(match[1]);
	}
	return specifiers;
}

/** `./bridge-protocol` 在引擎里解析成 `src/bridge-protocol.ts`。 */
function resolveEngineModule(fromRel: string, specifier: string): string[] {
	const base = posix.normalize(posix.join(posix.dirname(fromRel), specifier));
	return [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`];
}

it("ships every engine source file", () => {
	const shipped = new Set(Object.keys(ENGINE_FILES));
	const missing = walk(engineSrc)
		.map(engineRel)
		.filter((rel) => !shipped.has(rel));
	expect(missing).toEqual([]);
});

it("ships every engine-relative import target", () => {
	const shipped = new Set(Object.keys(ENGINE_FILES));
	const unresolved: string[] = [];
	for (const file of walk(engineSrc)) {
		const rel = engineRel(file);
		for (const specifier of relativeImportsOf(readFileSync(file, "utf8"))) {
			const candidates = resolveEngineModule(rel, specifier);
			if (!candidates.some((candidate) => shipped.has(candidate))) {
				unresolved.push(`${rel} → ${specifier}`);
			}
		}
	}
	expect(unresolved).toEqual([]);
});
