import type { RuntimeConversationSessionRoot } from "@astravia/runtime-node/conversation";
import type { DesktopSessionSearchRequest } from "../../shared/session-search.js";
import type { SessionSearchSource } from "./session-search-service.js";

export type SessionSearchWorkerRequest =
	| {
			type: "start";
			requestId: string;
			request: DesktopSessionSearchRequest;
			sources: SessionSearchSource[];
			roots: RuntimeConversationSessionRoot[];
	  }
	| { type: "cancel"; requestId: string }
	| { type: "invalidate" };
