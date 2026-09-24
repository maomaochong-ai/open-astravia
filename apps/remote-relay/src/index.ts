import { REMOTE_PROTOCOL_VERSION } from "@vetta/remote-control";
import { REMOTE_DESKTOP_WEBSOCKET_PROTOCOL } from "@vetta/remote-desktop/protocol";
import { pairingSecretFromHeaders, parseDesktopRoute, parseRelayRoute, sha256 } from "./auth.js";
import { relayInfo, relayWarn } from "./relay-log.js";
import { RemoteDesktopRoom } from "./remote-desktop-room.js";
import { RemotePairRoom } from "./remote-pair-room.js";

interface Env {
	readonly REMOTE_PAIR_ROOM: DurableObjectNamespace<RemotePairRoom>;
	readonly REMOTE_DESKTOP_ROOM: DurableObjectNamespace<RemoteDesktopRoom>;
}

const securityHeaders = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
} as const;

export { RemoteDesktopRoom, RemotePairRoom };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health") {
			return json({ status: "ok", protocolVersion: REMOTE_PROTOCOL_VERSION });
		}
		const controlRoute = parseRelayRoute(url.pathname);
		const desktopRoute = parseDesktopRoute(url.pathname);
		const route = controlRoute ?? desktopRoute;
		if (!route) return json({ error: "not_found" }, 404);
		if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return json({ error: "websocket_upgrade_required" }, 426);
		}
		const requiredProtocol = desktopRoute ? REMOTE_DESKTOP_WEBSOCKET_PROTOCOL : undefined;
		const credentials = pairingSecretFromHeaders(request.headers, requiredProtocol);
		if (!credentials) {
			relayWarn("upgrade_rejected", { role: route.role, reason: "missing_pairing_protocol" });
			return json({ error: "unauthorized" }, 401);
		}
		const [credentialHash, pairingHash] = await Promise.all([
			sha256(credentials.pairingSecret),
			sha256(route.pairingId),
		]);
		const roomTag = pairingHash.slice(0, 12);
		const namespace = desktopRoute ? env.REMOTE_DESKTOP_ROOM : env.REMOTE_PAIR_ROOM;
		// WebRTC signaling has no credentials of its own: the pair room, which
		// the desktop registered over the control channel, vouches for both roles.
		let preauthorized: "mobile" | "desktop" | undefined;
		if (desktopRoute) {
			const relayRole = desktopRoute.role === "viewer" ? "mobile" : "desktop";
			const authStub = env.REMOTE_PAIR_ROOM.get(env.REMOTE_PAIR_ROOM.idFromName(route.pairingId));
			const authResponse = await authStub.fetch(
				new Request("https://remote-pair-room.internal/authorize", {
					method: "POST",
					headers: { "X-Vetta-Relay-Role": relayRole, "X-Vetta-Credential-Hash": credentialHash },
				}),
			);
			if (!authResponse.ok) {
				relayWarn("upgrade_rejected", { role: route.role, reason: "not_registered_or_invalid" });
				return json({ error: "unauthorized" }, 401);
			}
			preauthorized = relayRole;
		}
		const id = namespace.idFromName(route.pairingId);
		const stub = namespace.get(id);
		const internalRequest = new Request("https://remote-pair-room.internal/connect", {
			headers: {
				Upgrade: "websocket",
				...(desktopRoute ? { "X-Vetta-Desktop-Role": desktopRoute.role } : { "X-Vetta-Relay-Role": route.role }),
				"X-Vetta-Credential-Hash": credentialHash,
				...(credentials.peerCredentialHash ? { "X-Vetta-Peer-Hash": credentials.peerCredentialHash } : {}),
				...(preauthorized ? { "X-Vetta-Preauthorized": preauthorized } : {}),
				"X-Vetta-Room-Tag": roomTag,
			},
		});
		const response = await stub.fetch(internalRequest);
		relayInfo("upgrade_completed", { roomTag, role: route.role, status: response.status });
		return response;
	},
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" },
	});
}
