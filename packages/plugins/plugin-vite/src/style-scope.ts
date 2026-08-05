import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Container, type Node, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Plugin } from "vite";

const PLUGIN_ROOT_ATTRIBUTE = "data-vetta-plugin-root";
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEYFRAMES_PATTERN = /(?:^|-)keyframes$/i;

function createPluginRootAttribute(pluginId: string) {
	return selectorParser.attribute({
		attribute: PLUGIN_ROOT_ATTRIBUTE,
		operator: "=",
		quoteMark: '"',
		raws: {},
		value: pluginId,
	});
}

function isInsideKeyframes(rule: Rule): boolean {
	let parent: Node | undefined = rule.parent;
	while (parent) {
		if (
			parent.type === "atrule" &&
			"name" in parent &&
			typeof parent.name === "string" &&
			KEYFRAMES_PATTERN.test(parent.name)
		) {
			return true;
		}
		parent = parent.parent;
	}
	return false;
}

function replacePluginRootSelectors(selector: string): string {
	return selectorParser((selectors) => {
		selectors.walkPseudos((pseudo) => {
			if (pseudo.value === ":root") {
				pseudo.replaceWith(selectorParser.pseudo({ value: ":scope" }));
				return;
			}
			if (pseudo.value === ":host") {
				const hostArgumentNodes =
					pseudo.nodes.length === 1 ? pseudo.nodes[0].nodes.map((node) => node.clone()) : [];
				pseudo.replaceWith(selectorParser.pseudo({ value: ":scope" }), ...hostArgumentNodes);
			}
		});
	}).processSync(selector);
}

function isKeyframesAtRule(node: Node): boolean {
	return node.type === "atrule" && KEYFRAMES_PATTERN.test((node as AtRule).name);
}

function createScopeRule(pluginId: string): AtRule {
	return postcss.atRule({
		name: "scope",
		params: `(${createPluginRootAttribute(pluginId).toString()})`,
	});
}

function scopeRulesInContainer(container: Container, pluginId: string): void {
	if (!container.nodes) return;
	let currentScope: AtRule | undefined;
	for (const node of [...container.nodes]) {
		if (node.type === "rule") {
			if (!currentScope) {
				currentScope = createScopeRule(pluginId);
				node.before(currentScope);
			}
			currentScope.append(node);
			continue;
		}

		currentScope = undefined;
		if (node.type === "atrule" && !isKeyframesAtRule(node)) {
			const atRule = node as AtRule;
			if (atRule.nodes) scopeRulesInContainer(atRule, pluginId);
		}
	}
}

function scopePluginCss(css: string, pluginId: string): string {
	const root = postcss.parse(css);
	root.walkRules((rule) => {
		if (isInsideKeyframes(rule)) return;
		rule.selector = replacePluginRootSelectors(rule.selector);
	});
	scopeRulesInContainer(root, pluginId);
	return root.toString();
}

function readPluginId(rootDir: string): string {
	const manifestPath = join(rootDir, "plugin.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown };
	if (typeof manifest.id !== "string" || !PLUGIN_ID_PATTERN.test(manifest.id)) {
		throw new Error(`Invalid plugin id in ${manifestPath}`);
	}
	return manifest.id;
}

export function createPluginStyleScopePlugin(): Plugin {
	let pluginId = "";
	let command: "build" | "serve" = "build";
	return {
		name: "vetta-plugin-style-scope",
		enforce: "pre",
		configResolved(config) {
			pluginId = readPluginId(config.root);
			command = config.command;
		},
		transform(code, id) {
			if (command !== "serve" || !id.split("?", 1)[0].endsWith(".css")) return;
			return {
				code: scopePluginCss(code, pluginId),
				map: null,
			};
		},
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type !== "asset" || !output.fileName.endsWith(".css")) continue;
				const css = typeof output.source === "string" ? output.source : Buffer.from(output.source).toString("utf8");
				output.source = scopePluginCss(css, pluginId);
			}
		},
	};
}
