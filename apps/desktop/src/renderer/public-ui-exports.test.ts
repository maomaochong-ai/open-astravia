import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

interface SourcePackage {
	name: string;
	exports: Record<string, string | { types: string; import: string }>;
}

describe("source UI package public entrypoints", () => {
	it("resolves granular entries and package roots to the same source module without directory aliases", async () => {
		const server = await createServer({
			configFile: false,
			root: resolve(repoRoot, "apps/desktop/src/renderer"),
			server: { middlewareMode: true, watch: null },
			optimizeDeps: { noDiscovery: true, include: [] },
		});
		try {
			for (const directory of ["theme-ui", "ui", "theme-sdk"]) {
				const packageRoot = resolve(repoRoot, "packages", directory);
				const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")) as SourcePackage;
				for (const [subpath, entry] of Object.entries(manifest.exports)) {
					if (typeof entry === "string" || (subpath !== "." && entry.import.endsWith("/index.ts"))) continue;
					const specifier = `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`;
					const result = await server.environments.client.pluginContainer.resolveId(
						specifier,
						resolve(repoRoot, "apps/desktop/src/renderer/main.tsx"),
					);
					expect(result?.id, specifier).toBe(resolve(packageRoot, entry.import));
				}
			}
		} finally {
			await server.close();
		}
	});
});

it("keeps remote themes, hidden global views and 3D achievements outside the initial application graph", () => {
	const configPath = resolve(repoRoot, "apps/desktop/tsconfig.json");
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const options = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(repoRoot, "apps/desktop")).options;
	const visited = new Set<string>();
	const imports = new Set<string>();
	const pending = [resolve(repoRoot, "apps/desktop/src/renderer/renderApp.tsx")];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || visited.has(file) || file.includes("node_modules") || file.endsWith(".d.ts")) continue;
		visited.add(file);
		const source = ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest, true);
		for (const node of source.statements) {
			if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
			if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
			if (ts.isImportDeclaration(node)) {
				const clause = node.importClause;
				if (clause?.isTypeOnly) continue;
				if (
					!clause?.name &&
					clause?.namedBindings &&
					ts.isNamedImports(clause.namedBindings) &&
					clause.namedBindings.elements.every((element) => element.isTypeOnly)
				)
					continue;
			} else if (
				node.isTypeOnly ||
				(node.exportClause &&
					ts.isNamedExports(node.exportClause) &&
					node.exportClause.elements.every((element) => element.isTypeOnly))
			)
				continue;
			imports.add(node.moduleSpecifier.text);
			const target = ts.resolveModuleName(node.moduleSpecifier.text, file, options, ts.sys).resolvedModule;
			if (target?.resolvedFileName.startsWith(repoRoot)) pending.push(target.resolvedFileName);
		}
	}
	expect(imports.has("three")).toBe(false);
	expect(
		[...visited].filter((file) => /(?:RootOverlayViews|themeLoader|AchievementPromotionBadge3D)\.tsx?$/.test(file)),
	).toEqual([]);
});
