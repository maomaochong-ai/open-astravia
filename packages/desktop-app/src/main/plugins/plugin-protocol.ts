import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type CustomScheme, protocol } from "electron";
import { resolvePluginFilePath } from "./plugin-store.js";

function contentTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".wasm":
			return "application/wasm";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function moduleResponse(source: string): Response {
	return new Response(source, {
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"access-control-allow-origin": "*",
			// Never cache: the host shim / plugin assets are served from fixed URLs
			// (e.g. remoteEntry.js?v=<version>), so a cached copy would pin stale code
			// across rebuilds/restarts even though the on-disk bundle changed.
			"cache-control": "no-store",
		},
	});
}

function hostModuleResponse(moduleName: string): Response {
	if (moduleName === "react") {
		return moduleResponse(`
const React = globalThis.__VETTA_PLUGIN_HOST__.React;
export default React;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
`);
	}
	if (moduleName === "react/jsx-runtime") {
		return moduleResponse(`
const jsxRuntime = globalThis.__VETTA_PLUGIN_HOST__.jsxRuntime;
export const Fragment = jsxRuntime.Fragment;
export const jsx = jsxRuntime.jsx;
export const jsxs = jsxRuntime.jsxs;
`);
	}
	if (moduleName === "react/jsx-dev-runtime") {
		return moduleResponse(`
const jsxDevRuntime = globalThis.__VETTA_PLUGIN_HOST__.jsxDevRuntime;
export const Fragment = jsxDevRuntime.Fragment;
export const jsxDEV = jsxDevRuntime.jsxDEV;
`);
	}
	if (moduleName === "plugin-sdk") {
		// 须与 @vetta-org/plugin-sdk 的运行时导出保持同步（纯类型导出无需列出）：
		// 插件构建时 @vetta-org/plugin-sdk 被外部化为本模块，漏列会在插件模块求值时
		// 抛 "does not provide an export named ..." 导致整个插件加载失败。
		return moduleResponse(`
const sdk = globalThis.__VETTA_PLUGIN_HOST__.pluginSdk;
export const PLUGIN_PERMISSIONS = sdk.PLUGIN_PERMISSIONS;
export const definePlugin = sdk.definePlugin;
export const useActiveConversation = sdk.useActiveConversation;
export const useConversationMessages = sdk.useConversationMessages;
export const usePromptAttachment = sdk.usePromptAttachment;
export const useActivityTab = sdk.useActivityTab;
export const __ActivityTabContext = sdk.__ActivityTabContext;
export const __setPluginHostBridge = sdk.__setPluginHostBridge;
export const useTranslation = sdk.useTranslation;
export const __PluginI18nContext = sdk.__PluginI18nContext;
export const interpolatePluginText = sdk.interpolatePluginText;
export const resolveCatalogKey = sdk.resolveCatalogKey;
export const resolvePluginText = sdk.resolvePluginText;
export const definePluginPromptContext = sdk.definePluginPromptContext;
export const PluginAppActionError = sdk.PluginAppActionError;
export const PluginMediaError = sdk.PluginMediaError;
export const usePluginShortcutScope = sdk.usePluginShortcutScope;
`);
	}
	if (moduleName === "ui" || moduleName === "vetta-ui") {
		// Legacy ESM / explicit vetta-host:// imports. MF plugins normally resolve
		// @vetta/ui via share scope; keep export list in sync with packages/ui/src/index.ts.
		return moduleResponse(`
const ui = globalThis.__VETTA_PLUGIN_HOST__.vettaUi;
export const Button = ui.Button;
export const buttonVariants = ui.buttonVariants;
export const Dialog = ui.Dialog;
export const DialogClose = ui.DialogClose;
export const DialogContent = ui.DialogContent;
export const DialogDescription = ui.DialogDescription;
export const DialogFooter = ui.DialogFooter;
export const DialogHeader = ui.DialogHeader;
export const DialogOverlay = ui.DialogOverlay;
export const DialogPortal = ui.DialogPortal;
export const DialogTitle = ui.DialogTitle;
export const DialogTrigger = ui.DialogTrigger;
export const Drawer = ui.Drawer;
export const DrawerClose = ui.DrawerClose;
export const DrawerContent = ui.DrawerContent;
export const DrawerDescription = ui.DrawerDescription;
export const DrawerFooter = ui.DrawerFooter;
export const DrawerHeader = ui.DrawerHeader;
export const DrawerOverlay = ui.DrawerOverlay;
export const DrawerPortal = ui.DrawerPortal;
export const DrawerTitle = ui.DrawerTitle;
export const DrawerTrigger = ui.DrawerTrigger;
export const DropdownMenu = ui.DropdownMenu;
export const DropdownMenuContent = ui.DropdownMenuContent;
export const DropdownMenuItem = ui.DropdownMenuItem;
export const DropdownMenuLabel = ui.DropdownMenuLabel;
export const DropdownMenuRadioGroup = ui.DropdownMenuRadioGroup;
export const DropdownMenuRadioItem = ui.DropdownMenuRadioItem;
export const DropdownMenuSeparator = ui.DropdownMenuSeparator;
export const DropdownMenuSub = ui.DropdownMenuSub;
export const DropdownMenuSubContent = ui.DropdownMenuSubContent;
export const DropdownMenuSubTrigger = ui.DropdownMenuSubTrigger;
export const DropdownMenuTrigger = ui.DropdownMenuTrigger;
export const Popover = ui.Popover;
export const PopoverAnchor = ui.PopoverAnchor;
export const PopoverArrow = ui.PopoverArrow;
export const PopoverContent = ui.PopoverContent;
export const PopoverDescription = ui.PopoverDescription;
export const PopoverHeader = ui.PopoverHeader;
export const PopoverTitle = ui.PopoverTitle;
export const PopoverTrigger = ui.PopoverTrigger;
export const Select = ui.Select;
export const SelectContent = ui.SelectContent;
export const SelectGroup = ui.SelectGroup;
export const SelectItem = ui.SelectItem;
export const SelectLabel = ui.SelectLabel;
export const SelectScrollDownButton = ui.SelectScrollDownButton;
export const SelectScrollUpButton = ui.SelectScrollUpButton;
export const SelectSeparator = ui.SelectSeparator;
export const SelectTrigger = ui.SelectTrigger;
export const SelectValue = ui.SelectValue;
export const Slider = ui.Slider;
export const Spin = ui.Spin;
export const Switch = ui.Switch;
export const cn = ui.cn;
`);
	}
	return new Response("Not found", { status: 404 });
}

/**
 * registerSchemesAsPrivileged 整个进程只能调用一次，
 * 故此处只导出特权声明，由 main.ts 合并所有自定义 scheme 统一注册。
 */
export const PLUGIN_PROTOCOL_PRIVILEGES: CustomScheme[] = [
	{
		scheme: "vetta-plugin",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
	{
		scheme: "vetta-host",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
];

export function registerPluginProtocols(): void {
	protocol.handle("vetta-plugin", async (request) => {
		const url = new URL(request.url);
		const pluginId = url.hostname;
		const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		const filePath = resolvePluginFilePath(pluginId, relativePath);
		if (!existsSync(filePath)) return new Response("Not found", { status: 404 });
		const body = await readFile(filePath);
		return new Response(body, {
			headers: {
				"content-type": contentTypeForPath(filePath),
				"access-control-allow-origin": "*",
				// Never cache plugin assets — remoteEntry.js has a fixed name, so a
				// cached copy would pin stale code across rebuilds/restarts.
				"cache-control": "no-store",
			},
		});
	});

	protocol.handle("vetta-host", async (request) => {
		const url = new URL(request.url);
		const moduleName = `${url.hostname}${url.pathname}`.replace(/\/$/, "");
		return hostModuleResponse(moduleName);
	});
}
