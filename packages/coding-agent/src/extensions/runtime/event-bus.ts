import type { EventBus } from "../infrastructure.js";

export interface ExtensionEventBusController extends EventBus {
	clear(): void;
}

interface EventSubscription {
	readonly handler: (data: unknown) => void;
}

export function createExtensionEventBus(): ExtensionEventBusController {
	const listeners = new Map<string, Set<EventSubscription>>();
	return {
		emit: (channel, data) => {
			const channelListeners = listeners.get(channel);
			if (!channelListeners) return;
			for (const subscription of [...channelListeners]) {
				void dispatchEventHandler(channel, subscription.handler, data);
			}
		},
		on: (channel, handler) => {
			const channelListeners = listeners.get(channel) ?? new Set();
			const subscription = { handler };
			channelListeners.add(subscription);
			listeners.set(channel, channelListeners);
			return () => {
				channelListeners.delete(subscription);
				if (channelListeners.size === 0) listeners.delete(channel);
			};
		},
		clear: () => listeners.clear(),
	};
}

async function dispatchEventHandler(channel: string, handler: (data: unknown) => void, data: unknown): Promise<void> {
	try {
		await handler(data);
	} catch (error) {
		console.error(`Event handler error (${channel}):`, error);
	}
}
