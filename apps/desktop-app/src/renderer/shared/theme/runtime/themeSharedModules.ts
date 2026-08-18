import type { ModuleFederation } from "@module-federation/enhanced/runtime";
import * as themeSdk from "@vetta/theme-sdk";
import * as themeSdkPages from "@vetta/theme-sdk/pages";
import * as themeSdkRouting from "@vetta/theme-sdk/routing";
import * as themeSdkStorage from "@vetta/theme-sdk/storage";
import * as themeSdkUsage from "@vetta/theme-sdk/usage";
import * as themeUi from "@vetta/theme-ui";
import * as themeUiAppShell from "@vetta/theme-ui/app-shell";
import * as themeUiSidebar from "@vetta/theme-ui/sidebar";
import * as vettaUi from "@vetta/ui";
import * as MotionReact from "motion/react";
import * as React from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as desktopThemeAppShell from "../sdk/app-shell";
import * as desktopThemeSidebar from "../sdk/sidebar-primitives";

type ModuleFederationShared = Parameters<typeof ModuleFederation.prototype.initOptions>[0]["shared"];

const sharedModules = {
	"@vetta/desktop-theme-ui/app-shell": { module: desktopThemeAppShell, version: "0.1.0" },
	"@vetta/desktop-theme-ui/sidebar": { module: desktopThemeSidebar, version: "0.1.0" },
	"@vetta/theme-sdk": { module: themeSdk, version: "0.1.0" },
	"@vetta/theme-sdk/pages": { module: themeSdkPages, version: "0.1.0" },
	"@vetta/theme-sdk/routing": { module: themeSdkRouting, version: "0.1.0" },
	"@vetta/theme-sdk/storage": { module: themeSdkStorage, version: "0.1.0" },
	"@vetta/theme-sdk/usage": { module: themeSdkUsage, version: "0.1.0" },
	"@vetta/theme-ui": { module: themeUi, version: "0.1.0" },
	"@vetta/theme-ui/app-shell": { module: themeUiAppShell, version: "0.1.0" },
	"@vetta/theme-ui/sidebar": { module: themeUiSidebar, version: "0.1.0" },
	"@vetta/ui": { module: vettaUi, version: "0.1.0" },
	"motion/react": { module: MotionReact, version: "12.23.12" },
	react: { module: React, version: React.version },
	"react-dom": { module: ReactDom, version: ReactDom.version },
	"react/jsx-runtime": { module: jsxRuntime, version: React.version },
	"react/jsx-dev-runtime": { module: jsxDevRuntime, version: React.version },
};

export function createThemeRuntimeShared(): NonNullable<ModuleFederationShared> {
	return Object.fromEntries(
		Object.entries(sharedModules).map(([name, shared]) => [
			name,
			{
				version: shared.version,
				lib: () => shared.module,
				shareConfig: { singleton: true, requiredVersion: false },
			},
		]),
	) as NonNullable<ModuleFederationShared>;
}
