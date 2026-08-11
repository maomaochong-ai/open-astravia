import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Container, type Node, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Plugin } from "vite";
import { hasOpaqueResourceQuery } from "./request-query.js";

const PLUGIN_ROOT_ATTRIBUTE = "data-vetta-plugin-root";
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEYFRAMES_PATTERN = /(?:^|-)keyframes$/i;
const ICONIFY_CLASS_PATTERN = /^icon-\[[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*\]$/u;
const ICONIFY_DECLARATION_VALUES: Readonly<Record<string, string>> = {
	width: "1em",
	height: "1em",
	"-webkit-mask-image": "var(--svg)",
	"mask-image": "var(--svg)",
	"background-color": "currentColor",
	display: "inline-block",
	"-webkit-mask-size": "100% 100%",
	"mask-size": "100% 100%",
	"-webkit-mask-repeat": "no-repeat",
	"mask-repeat": "no-repeat",
};
const ICONIFY_SVG_VALUE_PATTERN = /^url\((?:"|')?data:image\/svg\+xml,/u;
/**
 * 全局化的 Iconify 规则要放进一个嵌套 layer：插件样式表在宿主之后加载，
 * 而 `icon-[…]{width:1em;height:1em}` 与宿主的 `.w-4/.h-4` 同特异性，
 * 直接全局化会让宿主里任何同名图标退化成 1em（字号），把相邻文字挤偏。
 * 同一 layer 内「未嵌套的规则」优先于其子 layer，因此包一层即可让显式尺寸工具类稳定胜出，
 * 同时保留插件自身不写尺寸时的 1em 默认值。
 */
const ICONIFY_LAYER_NAME = "vetta-plugin-icons";

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

function hasOnlyIconifySelectors(rule: Rule): boolean {
	let selectorCount = 0;
	let valid = true;
	selectorParser((selectors) => {
		selectors.each((selector) => {
			selectorCount += 1;
			const nodes = selector.nodes.filter((node) => node.type !== "comment");
			const candidate = nodes[0];
			if (
				nodes.length !== 1 ||
				candidate?.type !== "class" ||
				!ICONIFY_CLASS_PATTERN.test(candidate.value)
			) {
				valid = false;
			}
		});
	}).processSync(rule.selector);
	return valid && selectorCount > 0;
}

function hasOnlyIconifyDeclarations(rule: Rule): boolean {
	let hasSvg = false;
	let hasMask = false;
	for (const node of rule.nodes) {
		if (node.type !== "decl") return false;
		if (node.prop === "--svg") {
			if (!ICONIFY_SVG_VALUE_PATTERN.test(node.value)) return false;
			hasSvg = true;
			continue;
		}
		if (ICONIFY_DECLARATION_VALUES[node.prop] !== node.value) return false;
		if (node.prop === "mask-image" || node.prop === "-webkit-mask-image") hasMask = true;
	}
	return hasSvg && hasMask;
}

function isSafeGlobalIconifyRule(rule: Rule): boolean {
	return hasOnlyIconifySelectors(rule) && hasOnlyIconifyDeclarations(rule);
}

function createScopeRule(pluginId: string): AtRule {
	return postcss.atRule({
		name: "scope",
		params: `(${createPluginRootAttribute(pluginId).toString()})`,
	});
}

function createIconifyLayerRule(): AtRule {
	return postcss.atRule({ name: "layer", params: ICONIFY_LAYER_NAME });
}

function scopeRulesInContainer(container: Container, pluginId: string): void {
	if (!container.nodes) return;
	let currentScope: AtRule | undefined;
	let currentIconifyLayer: AtRule | undefined;
	for (const node of [...container.nodes]) {
		if (node.type === "rule") {
			if (isSafeGlobalIconifyRule(node)) {
				currentScope = undefined;
				if (!currentIconifyLayer) {
					currentIconifyLayer = createIconifyLayerRule();
					node.before(currentIconifyLayer);
				}
				currentIconifyLayer.append(node);
				continue;
			}
			currentIconifyLayer = undefined;
			if (!currentScope) {
				currentScope = createScopeRule(pluginId);
				node.before(currentScope);
			}
			currentScope.append(node);
			continue;
		}

		currentScope = undefined;
		currentIconifyLayer = undefined;
		if (node.type === "atrule" && !isKeyframesAtRule(node)) {
			const atRule = node as AtRule;
			if (atRule.nodes) scopeRulesInContainer(atRule, pluginId);
		}
	}
}

export function scopePluginCss(css: string, pluginId: string): string {
	const root = postcss.parse(css);
	root.walkRules((rule) => {
		if (isInsideKeyframes(rule)) return;
		rule.selector = replacePluginRootSelectors(rule.selector);
	});
	scopeRulesInContainer(root, pluginId);
	return root.toString();
}

/**
 * Vite can import a CSS file as a JavaScript resource module via queries such
 * as `?raw`. Those requests keep the `.css` pathname, but their transform
 * input is JavaScript and must not be parsed by PostCSS. Other queries such as
 * `?direct` and HMR timestamps still represent stylesheet requests.
 */
export function isPluginStylesheetRequest(id: string): boolean {
	const queryIndex = id.indexOf("?");
	const pathname = queryIndex === -1 ? id : id.slice(0, queryIndex);
	if (!pathname.endsWith(".css")) return false;
	return !hasOpaqueResourceQuery(id);
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
			if (command !== "serve" || !isPluginStylesheetRequest(id)) return;
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
