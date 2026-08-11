/** Stable public contracts for Coding Agent Extensions. */
export { serializeConversation } from "../compaction/index.js";
export * from "../extensions/index.js";
export type { EventBus, ReadonlyFooterDataProvider } from "../extensions/infrastructure.js";
export {
	createExtensionEventBus as createEventBus,
	type ExtensionEventBusController as EventBusController,
} from "../extensions/runtime/event-bus.js";
export { convertToLlm } from "../model-context/index.js";
export {
	getLanguageFromPath,
	highlightCode,
	initTheme,
	Theme,
	type ThemeColor,
} from "../modes/interactive/theme/theme.js";
