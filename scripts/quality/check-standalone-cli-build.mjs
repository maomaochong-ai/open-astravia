import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const canonicalCompilerPath = "packages/cli-app/scripts/compile-standalone.mjs";
const governedConsumers = [
	"scripts/build-binaries.sh",
	"packages/desktop-app/scripts/prepare-pack.js",
	"packages/desktop-app/src/main/dev-cli-shim.ts",
];
const scanRoots = ["packages/cli-app/src", "packages/desktop-app/scripts", "packages/desktop-app/src/main"];
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

function normalizePath(value) {
	return value.replaceAll("\\", "/");
}

export function findStandaloneCliBuildViolations(filePath, source) {
	const normalizedFilePath = normalizePath(filePath);
	if (
		normalizedFilePath === canonicalCompilerPath ||
		normalizedFilePath.includes(".test.") ||
		normalizedFilePath.includes("/dist/") ||
		normalizedFilePath.includes("/release/")
	) {
		return [];
	}

	const compactSource = source.replace(/\s+/g, " ");
	if (!compactSource.includes("--compile")) {
		return [];
	}

	const referencesCliEntry =
		/packages[\\/]+cli-app[\\/]+src[\\/]+(?:agent-)?cli\.ts/i.test(compactSource) ||
		/(?:cliAppDir|cliAppRoot|cliAppPackageDir).{0,160}["']src["'].{0,120}["'](?:agent-)?cli\.ts["']/i.test(
			compactSource,
		);
	if (!referencesCliEntry) {
		return [];
	}

	return [`${normalizedFilePath}: 不得直接编译 cli-app CLI 源入口；请调用 ${canonicalCompilerPath}`];
}

async function collectSourceFiles(directoryPath) {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectSourceFiles(entryPath)));
		} else if (sourceExtensions.has(extname(entry.name))) {
			files.push(entryPath);
		}
	}
	return files;
}

export async function checkStandaloneCliBuild(rootPath = repositoryRoot) {
	const violations = [];
	for (const scanRoot of scanRoots) {
		const absoluteRoot = join(rootPath, scanRoot);
		for (const absoluteFilePath of await collectSourceFiles(absoluteRoot)) {
			const filePath = normalizePath(relative(rootPath, absoluteFilePath));
			const source = await readFile(absoluteFilePath, "utf8");
			violations.push(...findStandaloneCliBuildViolations(filePath, source));
		}
	}

	for (const consumerPath of governedConsumers) {
		const source = await readFile(join(rootPath, consumerPath), "utf8");
		if (!source.includes("compile-standalone.mjs")) {
			violations.push(`${consumerPath}: Desktop CLI 产物必须通过 ${canonicalCompilerPath} 构建`);
		}
	}

	return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const violations = await checkStandaloneCliBuild();
	if (violations.length > 0) {
		console.error(violations.join("\n"));
		process.exitCode = 1;
	} else {
		console.log("[standalone-cli-build] ok");
	}
}
