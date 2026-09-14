import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DOMAIN_CAPABILITY_CATALOG, FOUNDATION_CAPABILITY_CATALOG } from "../src/index.js";

const docsDirectory = resolve(import.meta.dir, "../../../docs/capabilities");
const jsonPath = resolve(docsDirectory, "catalog.json");
const markdownPath = resolve(docsDirectory, "catalog.md");
const check = process.argv.includes("--check");

const jsonContent = `${JSON.stringify(
	{
		generatedFrom: "@vetta-org/capability-sdk Capability Tokens",
		foundation: FOUNDATION_CAPABILITY_CATALOG,
		domain: DOMAIN_CAPABILITY_CATALOG,
	},
	null,
	2,
)}\n`;

function catalogRows(): string {
	return [...FOUNDATION_CAPABILITY_CATALOG, ...DOMAIN_CAPABILITY_CATALOG]
		.map(({ id, kind, layer, version }) => `| \`${id}\` | ${layer} | ${kind} | ${version} |`)
		.join("\n");
}

const markdownContent = `# Capability Catalog

> 此文件由 \`packages/capability-sdk/scripts/generate-catalog.ts\` 从 Capability Token 自动生成，请勿手工编辑。
> 完整输入输出 JSON Schema 见 [catalog.json](./catalog.json)。

| Capability ID | Layer | Kind | Version |
| --- | --- | --- | ---: |
${catalogRows()}
`;

async function assertCurrent(path: string, expected: string): Promise<boolean> {
	try {
		return (await readFile(path, "utf8")) === expected;
	} catch {
		return false;
	}
}

if (check) {
	const [jsonCurrent, markdownCurrent] = await Promise.all([
		assertCurrent(jsonPath, jsonContent),
		assertCurrent(markdownPath, markdownContent),
	]);
	if (!jsonCurrent || !markdownCurrent) {
		console.error("Capability Catalog documentation is stale. Run bun run catalog:generate in packages/capability-sdk.");
		process.exitCode = 1;
	}
} else {
	await Promise.all([
		writeFile(jsonPath, jsonContent, "utf8"),
		writeFile(markdownPath, markdownContent, "utf8"),
	]);
}
