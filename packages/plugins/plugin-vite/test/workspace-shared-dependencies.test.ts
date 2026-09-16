import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const pluginsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginDirectories = ["presets", "externals"] as const;
const defaultSharedDependencies = ["@vetta-org/plugin-sdk", "react", "react-dom"] as const;
const hostUiSpecifiers = new Set(["@vetta-org/ui", "@vetta/ui"]);
const codeExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

interface PackageManifest {
	devDependencies?: Record<string, string>;
}

interface PluginProject {
	manifest: PackageManifest;
	packagePath: string;
	root: string;
}

describe("workspace plugin shared dependencies", () => {
	it("declares default shared packages and opts into host UI only when source imports it", async () => {
		const projects = await loadPluginProjects();
		const violations: string[] = [];

		for (const project of projects) {
			if (project.manifest.devDependencies?.["@vetta-org/plugin-vite"] === undefined) continue;

			for (const dependency of defaultSharedDependencies) {
				if (project.manifest.devDependencies?.[dependency] === undefined) {
					violations.push(`${project.packagePath}: missing ${dependency}`);
				}
			}

			const importsHostUi = await sourceImportsHostUi(project.root);
			const enablesHostUi = await configEnablesHostUi(project.root);
			const declaresHostUi = project.manifest.devDependencies?.["@vetta-org/ui"] !== undefined;

			if (importsHostUi && !enablesHostUi) violations.push(`${project.packagePath}: missing hostUi: true`);
			if (importsHostUi && !declaresHostUi) violations.push(`${project.packagePath}: missing @vetta-org/ui`);
			if (!importsHostUi && enablesHostUi) violations.push(`${project.packagePath}: unused hostUi: true`);
			if (!importsHostUi && declaresHostUi) violations.push(`${project.packagePath}: unused @vetta-org/ui`);
		}

		expect(violations).toEqual([]);
	});
});

async function loadPluginProjects(): Promise<PluginProject[]> {
	const projects = await Promise.all(
		pluginDirectories.map(async (directory) => {
			const directoryPath = resolve(pluginsRoot, directory);
			const entries = await readdir(directoryPath, { withFileTypes: true });
			return Promise.all(
				entries
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const root = resolve(directoryPath, entry.name);
						const packagePath = `${directory}/${entry.name}/package.json`;
						const manifest = JSON.parse(await readFile(resolve(pluginsRoot, packagePath), "utf8")) as PackageManifest;
						return { manifest, packagePath, root };
					}),
			);
		}),
	);
	return projects.flat();
}

async function sourceImportsHostUi(root: string): Promise<boolean> {
	const files = await listCodeFiles(resolve(root, "src"));
	for (const file of files) {
		const sourceFile = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, false);
		let found = false;
		const visit = (node: ts.Node): void => {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteralLike(node.moduleSpecifier) &&
				hostUiSpecifiers.has(node.moduleSpecifier.text)
			) {
				found = true;
				return;
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
		if (found) return true;
	}
	return false;
}

async function configEnablesHostUi(root: string): Promise<boolean> {
	const path = resolve(root, "vite.config.ts");
	const sourceFile = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	let enabled = false;
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "vettaPluginFederation"
		) {
			const options = node.arguments[0];
			if (options && ts.isObjectLiteralExpression(options)) {
				enabled = options.properties.some(
					(property) =>
						ts.isPropertyAssignment(property) &&
						property.name.getText(sourceFile) === "hostUi" &&
						property.initializer.kind === ts.SyntaxKind.TrueKeyword,
				);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return enabled;
}

async function listCodeFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = resolve(root, entry.name);
			if (entry.isDirectory()) return listCodeFiles(path);
			return Promise.resolve(codeExtensions.has(extname(entry.name)) ? [path] : []);
		}),
	);
	return nested.flat();
}
