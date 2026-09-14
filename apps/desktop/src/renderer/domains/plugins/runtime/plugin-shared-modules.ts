import type { ModuleFederation } from "@module-federation/enhanced/runtime";
import * as pluginSdk from "@vetta-org/plugin-sdk";
import * as themeUiPlugin from "@vetta-org/theme-ui/plugin-ui";
import * as vettaUi from "@vetta-org/ui";
import * as React from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";

export interface PluginSharedModule {
	module: unknown;
	version: string;
	singleton: boolean;
	requiredVersion: string | false;
}

export const pluginSharedModules = {
	"@vetta-org/plugin-sdk": {
		module: pluginSdk,
		version: "1.0.0",
		singleton: true,
		requiredVersion: false,
	},
	// Host design-system primitives (Button/Dialog/…). Plugins may import optionally;
	// runtime is host singleton so they match App chrome. Not a frozen public API.
	"@vetta-org/ui": {
		module: vettaUi,
		version: "0.0.1",
		singleton: true,
		requiredVersion: false,
	},
	// 兼容别名：这个包 0.1.0 之前叫 @vetta/ui。名字就是 MF 的共享键，市场上按旧名构建的
	// 插件在它们的 remoteEntry 里声明的仍是旧名——只提供新名会让它们在共享域里落空，
	// 退回自己打包的那一份，于是宿主与插件各持一份组件实例。指向同一个 module 即可。
	"@vetta/ui": {
		module: vettaUi,
		version: "0.0.1",
		singleton: true,
		requiredVersion: false,
	},
	// 宿主成品 UI 组件（模型选择器等）。清单有意收窄，见 theme-ui/src/plugin-ui。
	"@vetta-org/theme-ui/plugin-ui": {
		module: themeUiPlugin,
		version: "0.0.1",
		singleton: true,
		requiredVersion: false,
	},
	// 兼容别名，理由同上：这个包 0.1.0 之前叫 @vetta/theme-ui。
	"@vetta/theme-ui/plugin-ui": {
		module: themeUiPlugin,
		version: "0.0.1",
		singleton: true,
		requiredVersion: false,
	},
	react: {
		module: React,
		version: React.version,
		singleton: true,
		requiredVersion: false,
	},
	"react-dom": {
		module: ReactDom,
		version: ReactDom.version,
		singleton: true,
		requiredVersion: false,
	},
	// tldraw / some remotes share this subpath; host must provide it (RUNTIME-015).
	"react-dom/client": {
		module: ReactDomClient,
		version: ReactDom.version,
		singleton: true,
		requiredVersion: false,
	},
	"react/jsx-runtime": {
		module: jsxRuntime,
		version: React.version,
		singleton: true,
		requiredVersion: false,
	},
	"react/jsx-dev-runtime": {
		module: jsxDevRuntime,
		version: React.version,
		singleton: true,
		requiredVersion: false,
	},
} satisfies Record<string, PluginSharedModule>;

type ModuleFederationShared = Parameters<typeof ModuleFederation.prototype.initOptions>[0]["shared"];

export function createPluginRuntimeShared(): NonNullable<ModuleFederationShared> {
	return Object.fromEntries(
		Object.entries(pluginSharedModules).map(([name, shared]) => [
			name,
			{
				version: shared.version,
				lib: () => shared.module,
				shareConfig: {
					singleton: shared.singleton,
					requiredVersion: shared.requiredVersion,
				},
			},
		]),
	) as NonNullable<ModuleFederationShared>;
}

export function installViteFederationSharedCache(share: Record<string, unknown>): void {
	for (const [name, shared] of Object.entries(pluginSharedModules)) {
		share[name] = shared.module;
	}
}

export const pluginHostShimModules = {
	React,
	ReactDom,
	ReactDomClient,
	jsxRuntime,
	jsxDevRuntime,
	pluginSdk,
	vettaUi,
	themeUiPlugin,
};
