import type { Api, Model } from "@vetta/ai";
import { type Theme, theme } from "../../../modes/interactive/theme/theme.js";
import type {
	CompactOptions,
	ContextUsage,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionModelCatalog,
} from "../../context-contracts.js";
import { bindExtensionRuntimeActions, type ExtensionExecutionHost } from "../../runtime-bindings.js";
import type {
	ExtensionCommandContextActions,
	ExtensionContextActions,
	ExtensionRuntime,
} from "../../runtime-contracts.js";
import type { ExtensionSessionView } from "../../session-contracts.js";
import type {
	EcosystemPermissionHookRequest,
	EcosystemPermissionHookResult,
	ExtensionUIContext,
} from "../../ui-contracts.js";

const NO_UI: ExtensionUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	onTerminalInput: () => () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setHeader: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	pasteToEditor: () => {},
	setEditorText: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	setEditorComponent: () => {},
	get theme() {
		return theme;
	},
	getAllThemes: () => [],
	getTheme: () => undefined,
	setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
	getToolsExpanded: () => false,
	setToolsExpanded: () => {},
};

export class ExtensionContextHost {
	private uiContext: ExtensionUIContext = NO_UI;
	private getModel: () => Model<Api> | undefined = () => undefined;
	private isIdle: () => boolean = () => true;
	private waitForIdle: () => Promise<void> = async () => {};
	private abort: () => void = () => {};
	private hasPendingMessages: () => boolean = () => false;
	private getContextUsage: () => ContextUsage | undefined = () => undefined;
	private compact: (options?: CompactOptions) => void = () => {};
	private getSystemPrompt: () => string = () => "";
	private newSession: ExtensionCommandContextActions["newSession"] = async () => ({ cancelled: false });
	private fork: ExtensionCommandContextActions["fork"] = async () => ({ cancelled: false });
	private navigateTree: ExtensionCommandContextActions["navigateTree"] = async () => ({ cancelled: false });
	private switchSession: ExtensionCommandContextActions["switchSession"] = async () => ({ cancelled: false });
	private reload: ExtensionCommandContextActions["reload"] = async () => {};
	private shutdownHandler: () => void = () => {};
	private permissionHandler?: (
		request: EcosystemPermissionHookRequest,
	) => Promise<EcosystemPermissionHookResult | undefined>;

	constructor(
		private readonly runtime: ExtensionRuntime,
		private readonly cwd: string,
		private readonly sessionManager: ExtensionSessionView,
		private readonly modelCatalog: ExtensionModelCatalog,
	) {}

	bindExecutionHost(host: ExtensionExecutionHost): void {
		bindExtensionRuntimeActions(this.runtime, host.actions);
		this.getModel = host.contextActions.getModel;
		this.isIdle = host.contextActions.isIdle;
		this.abort = host.contextActions.abort;
		this.hasPendingMessages = host.contextActions.hasPendingMessages;
		this.shutdownHandler = host.contextActions.shutdown;
		this.getContextUsage = host.contextActions.getContextUsage;
		this.compact = host.contextActions.compact;
		this.getSystemPrompt = host.contextActions.getSystemPrompt;
		for (const { name, config } of this.runtime.pendingProviderRegistrations) {
			this.modelCatalog.registerProvider(name, config);
		}
		this.runtime.pendingProviderRegistrations = [];
	}

	bindCore(actions: ExtensionExecutionHost["actions"], contextActions: ExtensionContextActions): void {
		this.bindExecutionHost({ actions, contextActions });
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		this.waitForIdle = actions?.waitForIdle ?? (async () => {});
		this.newSession = actions?.newSession ?? (async () => ({ cancelled: false }));
		this.fork = actions?.fork ?? (async () => ({ cancelled: false }));
		this.navigateTree = actions?.navigateTree ?? (async () => ({ cancelled: false }));
		this.switchSession = actions?.switchSession ?? (async () => ({ cancelled: false }));
		this.reload = actions?.reload ?? (async () => {});
	}

	setUIContext(uiContext?: ExtensionUIContext): void {
		this.uiContext = uiContext ?? NO_UI;
	}

	getUIContext(): ExtensionUIContext {
		return this.uiContext;
	}

	hasUI(): boolean {
		return this.uiContext !== NO_UI;
	}

	setEcosystemPermissionHandler(
		handler?: (request: EcosystemPermissionHookRequest) => Promise<EcosystemPermissionHookResult | undefined>,
	): void {
		this.permissionHandler = handler;
	}

	shutdown(): void {
		this.shutdownHandler();
	}

	createContext(): ExtensionContext {
		const getModel = this.getModel;
		const permissionHandler = this.permissionHandler;
		return {
			ui: this.uiContext,
			hasUI: this.hasUI(),
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelCatalog,
			get model() {
				return getModel();
			},
			isIdle: () => this.isIdle(),
			abort: () => this.abort(),
			hasPendingMessages: () => this.hasPendingMessages(),
			shutdown: () => this.shutdownHandler(),
			getContextUsage: () => this.getContextUsage(),
			compact: (options) => this.compact(options),
			getSystemPrompt: () => this.getSystemPrompt(),
			requestEcosystemPermission: permissionHandler ? (request) => permissionHandler(request) : undefined,
		};
	}

	createCommandContext(): ExtensionCommandContext {
		return {
			...this.createContext(),
			waitForIdle: () => this.waitForIdle(),
			newSession: (options) => this.newSession(options),
			fork: (entryId) => this.fork(entryId),
			navigateTree: (targetId, options) => this.navigateTree(targetId, options),
			switchSession: (sessionPath) => this.switchSession(sessionPath),
			reload: () => this.reload(),
		};
	}
}
