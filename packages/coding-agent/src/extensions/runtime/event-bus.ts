import { EventEmitter } from "node:events";
import type { EventBus } from "../infrastructure.js";

export interface ExtensionEventBusController extends EventBus {
	clear(): void;
}

export function createExtensionEventBus(): ExtensionEventBusController {
	const emitter = new EventEmitter();
	return {
		emit: (channel, data) => {
			emitter.emit(channel, data);
		},
		on: (channel, handler) => {
			const safeHandler = async (data: unknown) => {
				try {
					await handler(data);
				} catch (error) {
					console.error(`Event handler error (${channel}):`, error);
				}
			};
			emitter.on(channel, safeHandler);
			return () => emitter.off(channel, safeHandler);
		},
		clear: () => emitter.removeAllListeners(),
	};
}
