/** 全局快捷键绑定变更广播（设置页 / 热键监听 / Action 写路径共用）。 */
export const SHORTCUTS_CHANNELS = {
	/** main → renderer：{ bindings: Record<string, string> } */
	CHANGED: "vetta:shortcuts:changed",
} as const;

export interface ShortcutsBindingsChangedEvent {
	bindings: Record<string, string>;
}
