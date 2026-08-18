export function createStandaloneEntry(entry) {
	const runtimeImport =
		entry === "agent"
			? 'import { runAgentCli } from "../src/run-agent-cli.ts";'
			: 'import { runCli } from "../src/run-cli.ts";';
	const runtimeCall =
		entry === "agent"
			? "await runAgentCli(process.argv.slice(2), { htmlExporter });"
			: "await runCli(process.argv.slice(2), { htmlExporter });";
	return [
		runtimeImport,
		'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
		'import { createCodingAgentHtmlExportRuntime } from "../../../packages/coding-agent/src/public-api/export-html.ts";',
		'import { parseCodingAgentHistoricalSessionDocument } from "../../../packages/coding-agent/src/public-api/historical-sessions.ts";',
		'import { installBuiltinThemeDocuments } from "../../../packages/coding-agent/src/modes/interactive/theme/theme.ts";',
		'import { installPhotonModuleLoader, installPhotonWasmPath } from "../../../packages/runtime-node/src/coding/tools/read/photon.ts";',
		'import template from "../../../packages/coding-agent/src/export-html/assets/template.html" with { type: "text" };',
		'import css from "../../../packages/coding-agent/src/export-html/assets/template.css" with { type: "text" };',
		'import js from "../../../packages/coding-agent/src/export-html/assets/template.js" with { type: "text" };',
		'import markedJs from "../../../packages/coding-agent/src/export-html/assets/vendor/marked.min.js" with { type: "text" };',
		'import highlightJs from "../../../packages/coding-agent/src/export-html/assets/vendor/highlight.min.js" with { type: "text" };',
		'import darkTheme from "../../../packages/coding-agent/src/modes/interactive/theme/dark.json";',
		'import lightTheme from "../../../packages/coding-agent/src/modes/interactive/theme/light.json";',
		'import photonWasmPath from "../../../packages/coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" };',
		"",
		"const htmlExporter = createCodingAgentHtmlExportRuntime({",
		"	assets: { template, css, js, markedJs, highlightJs },",
		"	writer: { write: (outputPath, html) => writeFileSync(outputPath, html, \"utf8\") },",
		"	legacySessions: {",
		"		exists: existsSync,",
		"		read: (path) => parseCodingAgentHistoricalSessionDocument(readFileSync(path, \"utf8\")),",
		"	},",
		"});",
		"installBuiltinThemeDocuments({ dark: darkTheme, light: lightTheme });",
		"installPhotonWasmPath(photonWasmPath);",
		'installPhotonModuleLoader(() => import("../../../packages/coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs.js"));',
		runtimeCall,
		"",
	].join("\n");
}
