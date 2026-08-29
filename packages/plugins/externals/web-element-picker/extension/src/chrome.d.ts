// chrome.* 最小类型声明（避免引入 @types/chrome 依赖；仅覆盖本扩展用到的 API）。
// 与官方类型行为保持一致；上架前如需补全可替换为 @types/chrome。

declare namespace chrome {
	namespace runtime {
		const id: string;
		function getURL(path: string): string;
		function getManifest(): { version: string; name: string };
		function sendMessage(message: unknown): Promise<unknown>;
		const lastError: { message: string } | undefined;
		const onMessage: {
			addListener(
				cb: (
					message: unknown,
					sender: { tab?: chrome.tabs.Tab; id?: string; url?: string },
					sendResponse: (response?: unknown) => void,
				) => void | boolean,
			): void;
		};
	}
	namespace storage {
		namespace sync {
			function get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
			function set(items: Record<string, unknown>): Promise<void>;
			function remove(keys: string | string[]): Promise<void>;
		}
		namespace session {
			function get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
			function set(items: Record<string, unknown>): Promise<void>;
		}
		const onChanged: {
			addListener(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void): void;
		};
	}
	namespace tabs {
		interface Tab {
			id?: number;
			windowId?: number;
			url?: string;
			active?: boolean;
		}
		function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
		function sendMessage(tabId: number, message: unknown): Promise<unknown>;
		function captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<string>;
	}
	namespace downloads {
		function download(options: { url: string; filename?: string; saveAs?: boolean }): Promise<number>;
	}
	namespace i18n {
		function getMessage(name: string, substitutions?: string | string[]): string;
		function getUILanguage(): string;
	}
	namespace action {
		function setBadgeText(details: { text?: string }): void;
	}
}
