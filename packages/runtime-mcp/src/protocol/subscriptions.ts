import type { JsonRpcNotification } from "./types.js";

export const MCP_SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId" as const;

export interface McpSubscriptionFilter {
	readonly toolsListChanged?: boolean;
	readonly promptsListChanged?: boolean;
	readonly resourcesListChanged?: boolean;
	readonly resourceSubscriptions?: string[];
}

export interface McpSubscriptionNotificationParams {
	readonly _meta?: {
		readonly [MCP_SUBSCRIPTION_ID_META_KEY]?: string | number;
		readonly [key: string]: unknown;
	};
	readonly [key: string]: unknown;
}

export interface McpSubscriptionNotification extends JsonRpcNotification {
	readonly params?: McpSubscriptionNotificationParams;
}

export interface McpSubscriptionsListenResult {
	readonly resultType: "complete";
	readonly _meta: {
		readonly [MCP_SUBSCRIPTION_ID_META_KEY]: string | number;
		readonly [key: string]: unknown;
	};
}

export type McpSubscriptionHandler = (notification: McpSubscriptionNotification) => void | Promise<void>;
