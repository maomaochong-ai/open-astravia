/**
 * Enforce monorepo dependency direction (apps may depend on libs; libs must not
 * depend on apps / host packages).
 *
 * Rules (see README "依赖方向"):
 * - Core/runtime/libs must not import desktop-app, admin, site, cli-app
 * - plugins/** must not deep-import desktop-app internals
 * - packages must not import another package's test/ tree
 *
 * Usage:
 *   bun run scripts/quality/check-package-boundaries.mjs
 */

import { join } from "node:path";
import ts from "typescript";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

/** Path prefixes (posix, under repo root) that must stay host-agnostic. */
const LIB_PREFIXES = [
	"packages/capability-sdk/",
	"packages/capability-runtime/",
	"packages/ai/",
	"packages/agent/",
	"packages/coding-agent/",
	"packages/ecosystem-adapter/",
	"packages/runtime-core/",
	"packages/runtime-tools/",
	"packages/runtime-storage/",
	"packages/runtime-mcp/",
	"packages/runtime-telemetry/",
	"packages/action-rpc/",
	"packages/toolkit/",
	"packages/theme-sdk/",
	"packages/theme-ui/",
	"packages/markdown/",
	"packages/ui/",
	"packages/plugins/plugin-sdk/",
	"packages/plugins/plugin-vite/",
];

function isLibFile(posixPath) {
	return LIB_PREFIXES.some((prefix) => posixPath.startsWith(prefix));
}

function isPluginPackageFile(posixPath) {
	return posixPath.startsWith("packages/plugins/presets/") || posixPath.startsWith("packages/plugins/externals/");
}

function scriptKind(filePath) {
	if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
		return ts.ScriptKind.JS;
	}
	return ts.ScriptKind.TS;
}

export function collectImportSpecifiers(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	const specifiers = [];
	const add = (node) => {
		if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			add(node.moduleSpecifier);
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			add(node.moduleReference.expression);
		} else if (ts.isCallExpression(node) && node.arguments.length === 1) {
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			if (isDynamicImport || isRequire) add(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return specifiers;
}

function collectCapabilityIdLiterals(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	const capabilityIds = [];
	const visit = (node) => {
		if (ts.isStringLiteralLike(node) && /^cap\.(?:foundation|domain)\./.test(node.text)) {
			capabilityIds.push(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return capabilityIds;
}

function usesDesktopPluginGlobal(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	let found = false;
	const visit = (node) => {
		if (
			ts.isPropertyAccessExpression(node) &&
			node.name.text === "vetta" &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "window"
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

function forbiddenAppId(specifier) {
	const normalized = specifier.replaceAll("\\", "/");
	for (const packageName of ["@vetta/desktop-app", "@vetta/cli-app", "@vetta/site", "shadcn-admin"]) {
		if (normalized === packageName || normalized.startsWith(`${packageName}/`)) return packageName;
	}
	const match = normalized.match(/(?:^|\/)(desktop-app|admin|site)(?:\/|$)/);
	return match?.[1] ? `${match[1]} path` : null;
}

function checkForbiddenAppImports(posixPath, specifiers, findings) {
	if (!isLibFile(posixPath) && !isPluginPackageFile(posixPath)) return;
	for (const specifier of specifiers) {
		const id = forbiddenAppId(specifier);
		if (id) findings.push(`${posixPath}: libs/plugins must not import app package (${id})`);
	}
}

function checkTestTreeImports(posixPath, specifiers, findings) {
	const isTestFile = posixPath.includes("/test/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posixPath);
	if (isTestFile) return;
	for (const specifier of specifiers) {
		const normalized = specifier.replaceAll("\\", "/");
		if (/(?:^|\/)test(?:\/|$)/.test(normalized)) {
			findings.push(`${posixPath}: production code must not import test trees (${specifier})`);
		}
	}
}

function checkPluginDesktopDeepImport(posixPath, specifiers, findings) {
	if (!isPluginPackageFile(posixPath)) return;
	if (specifiers.some((specifier) => specifier.includes("desktop-app/src/") || specifier.startsWith("@/main/"))) {
		findings.push(`${posixPath}: plugins must not deep-import desktop-app internals`);
	}
}

function checkPluginDesktopGlobal(posixPath, text, findings) {
	if (!isPluginPackageFile(posixPath) || posixPath.endsWith(".d.ts")) return;
	// Explicit exceptions that must touch the host Desktop API surface:
	// - plugin-workbench: trusted host management UI (install/dev-watch)
	// - security-probe: intentional audit of window.vetta bypass / trust boundary
	if (posixPath.startsWith("packages/plugins/presets/plugin-workbench/")) return;
	if (posixPath.startsWith("packages/plugins/externals/security-probe/")) return;
	if (usesDesktopPluginGlobal(posixPath, text)) {
		findings.push(`${posixPath}: plugins must use the public plugin SDK instead of window.vetta`);
	}
}

function checkCapabilityLayerImports(posixPath, specifiers, findings) {
	const isCapabilitySdk = posixPath.startsWith("packages/capability-sdk/");
	const isCapabilityRuntime = posixPath.startsWith("packages/capability-runtime/");
	if (!isCapabilitySdk && !isCapabilityRuntime) return;

	const forbiddenPrefixes = [
		"@vetta-org/plugin-sdk",
		"@vetta/action-rpc",
		"@vetta/desktop-app",
		"@vetta/theme-sdk",
		"@vetta/theme-ui",
	];
	if (isCapabilitySdk) forbiddenPrefixes.push("@vetta/capability-runtime");
	for (const specifier of specifiers) {
		if (forbiddenPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
			findings.push(
				`${posixPath}: capability internals must not import public system SDKs or app packages (${specifier})`,
			);
		}
	}
}

function checkPublicSystemSdkImports(posixPath, specifiers, findings) {
	const isPublicSystemSdk =
		posixPath.startsWith("packages/theme-sdk/") || posixPath.startsWith("packages/plugins/plugin-sdk/");
	if (!isPublicSystemSdk) return;
	for (const specifier of specifiers) {
		if (specifier.startsWith("@vetta/capability-sdk/internal/")) {
			findings.push(`${posixPath}: public system SDKs must not expose built-in capability adapters (${specifier})`);
		}
	}
}

function checkRawCapabilityIds(posixPath, text, findings) {
	const isCapabilityDefinition =
		posixPath === "packages/capability-sdk/src/contracts.ts" ||
		posixPath.startsWith("packages/capability-sdk/src/domain/") ||
		posixPath.startsWith("packages/capability-sdk/src/foundation/");
	if (isCapabilityDefinition) return;
	for (const capabilityId of collectCapabilityIdLiterals(posixPath, text)) {
		findings.push(`${posixPath}: import a capability token instead of using raw id ${capabilityId}`);
	}
}

function checkCapabilitySchemaDefinitions(posixPath, text, findings) {
	const isCapabilityDefinition =
		posixPath.startsWith("packages/capability-sdk/src/domain/") ||
		posixPath.startsWith("packages/capability-sdk/src/foundation/");
	if (!isCapabilityDefinition || !text.includes("defineCapability<")) return;
	if (/\bparse(?:Input|Output)\s*:/.test(text)) {
		findings.push(`${posixPath}: capability tokens must use schema-backed input and output definitions`);
	}
	if (!text.includes("createCapabilityCatalog")) {
		findings.push(`${posixPath}: capability definition files must publish a generated catalog`);
	}
}

export function findPackageBoundaryViolations(posixPath, text) {
	const findings = [];
	const specifiers = collectImportSpecifiers(posixPath, text);
	checkForbiddenAppImports(posixPath, specifiers, findings);
	checkTestTreeImports(posixPath, specifiers, findings);
	checkPluginDesktopDeepImport(posixPath, specifiers, findings);
	checkPluginDesktopGlobal(posixPath, text, findings);
	checkCapabilityLayerImports(posixPath, specifiers, findings);
	checkPublicSystemSdkImports(posixPath, specifiers, findings);
	checkRawCapabilityIds(posixPath, text, findings);
	checkCapabilitySchemaDefinitions(posixPath, text, findings);
	return findings;
}

const roots = [
	join(repoRoot, "packages/capability-sdk"),
	join(repoRoot, "packages/capability-runtime"),
	join(repoRoot, "packages/ai"),
	join(repoRoot, "packages/agent"),
	join(repoRoot, "packages/coding-agent"),
	join(repoRoot, "packages/ecosystem-adapter"),
	join(repoRoot, "packages/runtime-core"),
	join(repoRoot, "packages/runtime-tools"),
	join(repoRoot, "packages/runtime-storage"),
	join(repoRoot, "packages/runtime-mcp"),
	join(repoRoot, "packages/runtime-telemetry"),
	join(repoRoot, "packages/action-rpc"),
	join(repoRoot, "packages/toolkit"),
	join(repoRoot, "packages/theme-sdk"),
	join(repoRoot, "packages/theme-ui"),
	join(repoRoot, "packages/markdown"),
	join(repoRoot, "packages/ui"),
	join(repoRoot, "packages/plugins"),
	join(repoRoot, "packages/themes"),
	join(repoRoot, "packages/desktop-app"),
];

export function main() {
	const findings = [];
	let scanned = 0;

	for (const root of roots) {
		for (const file of walkFiles(root)) {
			const posixPath = rel(file);
			if (posixPath.includes("/node_modules/") || posixPath.includes("/dist/")) continue;
			// examples under coding-agent may intentionally wire hosts; skip demos
			if (posixPath.includes("/examples/")) continue;
			let text;
			try {
				text = readText(file);
			} catch {
				continue;
			}
			scanned += 1;
			findings.push(...findPackageBoundaryViolations(posixPath, text));
		}
	}

	if (findings.length === 0) {
		ok(`[package-boundaries] ok (${scanned} file(s) scanned)`);
		return 0;
	}

	for (const line of findings) {
		fail(`[package-boundaries] ${line}`);
	}
	fail(`[package-boundaries] ${findings.length} violation(s)`);
	return 1;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
