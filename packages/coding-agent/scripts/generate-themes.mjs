// Embed built-in Theme JSON documents into TypeScript so Node/Electron ESM
// consumers do not depend on runtime JSON Module import attributes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeDirectory = join(packageRoot, "src", "modes", "interactive", "theme");
const outputFile = join(packageRoot, "src", "theme", "builtin-theme-documents.ts");
const checkOnly = process.argv.includes("--check");
const printOnly = process.argv.includes("--stdout");

const documents = Object.fromEntries(
	["dark", "light"].map((name) => {
		const source = readFileSync(join(themeDirectory, `${name}.json`), "utf-8");
		return [name, JSON.parse(source)];
	}),
);
const content = `// AUTO-GENERATED from src/modes/interactive/theme/{dark,light}.json by scripts/generate-themes.mjs. Do not edit by hand.\n\nexport const BUILTIN_THEME_DOCUMENTS = ${JSON.stringify(documents, null, "\t")} as const;\n`;

if (printOnly) {
	process.stdout.write(content);
} else if (checkOnly) {
	if (readFileSync(outputFile, "utf-8") !== content) {
		throw new Error("[generate-themes] builtin-theme-documents.ts is stale; run bun run generate:themes");
	}
	console.log("[generate-themes] 2 built-in themes are current");
} else {
	writeFileSync(outputFile, content, "utf-8");
	console.log("[generate-themes] wrote 2 built-in themes to builtin-theme-documents.ts");
}
