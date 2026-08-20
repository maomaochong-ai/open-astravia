export const REMOTE_DESKTOP_PROTOCOL_VERSION = 1 as const;
export const REMOTE_DESKTOP_WEBSOCKET_PROTOCOL = "vetta.desktop.v1";

export type RemoteDesktopRole = "viewer" | "host";

export type RemoteDesktopSignal =
	| {
			readonly type: "peer_ready";
			readonly protocolVersion: typeof REMOTE_DESKTOP_PROTOCOL_VERSION;
	  }
	| {
			readonly type: "offer";
			readonly protocolVersion: typeof REMOTE_DESKTOP_PROTOCOL_VERSION;
			readonly sessionId: string;
			readonly sdp: string;
	  }
	| {
			readonly type: "answer";
			readonly protocolVersion: typeof REMOTE_DESKTOP_PROTOCOL_VERSION;
			readonly sessionId: string;
			readonly sdp: string;
	  }
	| {
			readonly type: "ice";
			readonly protocolVersion: typeof REMOTE_DESKTOP_PROTOCOL_VERSION;
			readonly sessionId: string;
			readonly candidate: string;
			readonly sdpMid?: string | null;
			readonly sdpMLineIndex?: number | null;
	  }
	| {
			readonly type: "end";
			readonly protocolVersion: typeof REMOTE_DESKTOP_PROTOCOL_VERSION;
			readonly sessionId: string;
			readonly reason: "completed" | "revoked" | "failed" | "peer_closed";
	  };

export type RemoteInputMessage =
	| {
			readonly type: "pointer.move";
			readonly sequence: number;
			readonly x: number;
			readonly y: number;
	  }
	| {
			readonly type: "pointer.button";
			readonly sequence: number;
			readonly x: number;
			readonly y: number;
			readonly button: "left" | "middle" | "right";
			readonly action: "down" | "up";
	  }
	| {
			readonly type: "pointer.scroll";
			readonly sequence: number;
			readonly deltaX: number;
			readonly deltaY: number;
	  }
	| {
			readonly type: "key";
			readonly sequence: number;
			readonly code: string;
			readonly action: "down" | "up";
			readonly modifiers?: readonly ("alt" | "control" | "meta" | "shift")[];
	  }
	| {
			readonly type: "heartbeat";
			readonly sequence: number;
			readonly sentAt: number;
	  };

export type RemoteInputCommand = {
	[T in RemoteInputMessage as T["type"]]: Omit<T, "sequence">;
}[RemoteInputMessage["type"]];
