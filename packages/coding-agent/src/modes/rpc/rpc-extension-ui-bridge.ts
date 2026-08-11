import { randomUUID } from "node:crypto";
import { type Theme, theme } from "../interactive/theme/theme.js";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "./rpc-session-capabilities.js";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "./rpc-types.js";

export type RpcExtensionUIOutput = (request: RpcExtensionUIRequest) => void;

interface PendingExtensionRequest {
	resolve(response: RpcExtensionUIResponse): void;
	cancel(): void;
}

export class RpcExtensionUIBridge {
	private readonly pending = new Map<string, PendingExtensionRequest>();

	constructor(private readonly output: RpcExtensionUIOutput) {}

	createContext(): ExtensionUIContext {
		return {
			select: (title, options, dialogOptions) =>
				this.createDialogPromise(
					dialogOptions,
					undefined,
					{ method: "select", title, options, timeout: dialogOptions?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? undefined
							: "value" in response
								? response.value
								: undefined,
				),
			confirm: (title, message, dialogOptions) =>
				this.createDialogPromise(
					dialogOptions,
					false,
					{ method: "confirm", title, message, timeout: dialogOptions?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? false
							: "confirmed" in response
								? response.confirmed
								: false,
				),
			input: (title, placeholder, dialogOptions) =>
				this.createDialogPromise(
					dialogOptions,
					undefined,
					{ method: "input", title, placeholder, timeout: dialogOptions?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? undefined
							: "value" in response
								? response.value
								: undefined,
				),
			notify: (message, type) => {
				this.output({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "notify",
					message,
					notifyType: type,
				});
			},
			onTerminalInput: () => () => {},
			setStatus: (key, text) => {
				this.output({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "setStatus",
					statusKey: key,
					statusText: text,
				});
			},
			setWorkingMessage: () => {},
			setWidget: (key, content, options?: ExtensionWidgetOptions) => {
				if (content === undefined || Array.isArray(content)) {
					this.output({
						type: "extension_ui_request",
						id: randomUUID(),
						method: "setWidget",
						widgetKey: key,
						widgetLines: content as string[] | undefined,
						widgetPlacement: options?.placement,
					});
				}
			},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => {
				this.output({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "setTitle",
					title,
				});
			},
			custom: async () => undefined as never,
			pasteToEditor(text: string): void {
				this.setEditorText(text);
			},
			setEditorText: (text) => {
				this.output({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "set_editor_text",
					text,
				});
			},
			getEditorText: () => "",
			editor: (title, prefill) => this.createEditorPromise(title, prefill),
			setEditorComponent: () => {},
			get theme() {
				return theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: (_theme: string | Theme) => ({
				success: false,
				error: "Theme switching not supported in RPC mode",
			}),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}

	handle(response: RpcExtensionUIResponse): boolean {
		const request = this.pending.get(response.id);
		if (!request) return false;
		request.resolve(response);
		return true;
	}

	dispose(): void {
		for (const request of this.pending.values()) {
			request.cancel();
		}
		this.pending.clear();
	}

	private createDialogPromise<T>(
		options: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (options?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = randomUUID();
		return new Promise<T>((resolve) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				options?.signal?.removeEventListener("abort", onAbort);
				this.pending.delete(id);
			};
			const cancel = () => {
				cleanup();
				resolve(defaultValue);
			};
			const onAbort = () => cancel();
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			if (options?.timeout) {
				timeoutId = setTimeout(cancel, options.timeout);
			}
			this.pending.set(id, {
				resolve: (response) => {
					cleanup();
					resolve(parseResponse(response));
				},
				cancel,
			});
			this.output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	private createEditorPromise(title: string, prefill?: string): Promise<string | undefined> {
		const id = randomUUID();
		return new Promise<string | undefined>((resolve) => {
			const finish = (value: string | undefined) => {
				this.pending.delete(id);
				resolve(value);
			};
			this.pending.set(id, {
				resolve: (response) => {
					if ("cancelled" in response && response.cancelled) {
						finish(undefined);
					} else if ("value" in response) {
						finish(response.value);
					} else {
						finish(undefined);
					}
				},
				cancel: () => finish(undefined),
			});
			this.output({ type: "extension_ui_request", id, method: "editor", title, prefill });
		});
	}
}
