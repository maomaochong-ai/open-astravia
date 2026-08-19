import { REMOTE_DESKTOP_WEBSOCKET_PROTOCOL } from "@vetta/remote-desktop/protocol";
import { pairingSecretFromHeaders, parseRelayRoute, sha256 } from "./auth.js";
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
			return json({ status: "ok", protocolVersion: 1 });
		}
		const controlRoute = parseRelayRoute(url.pathname);
		const desktopRoute = parseDesktopRoute(url.pathname);
		const route = controlRoute ?? desktopRoute;
		if (!route) return json({ error: "not_found" }, 404);
		if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return json({ error: "websocket_upgrade_required" }, 426);
		}
		const requiredProtocol = desktopRoute ? REMOTE_DESKTOP_WEBSOCKET_PROTOCOL : undefined;
		const secret = pairingSecretFromHeaders(request.headers, requiredProtocol);
		if (!secret) {
			relayWarn("upgrade_rejected", { role: route.role, reason: "missing_pairing_protocol" });
			return json({ error: "unauthorized" }, 401);
		}
		const [credentialHash, pairingHash] = await Promise.all([sha256(secret), sha256(route.pairingId)]);
		const roomTag = pairingHash.slice(0, 12);
		const namespace = desktopRoute ? env.REMOTE_DESKTOP_ROOM : env.REMOTE_PAIR_ROOM;
		const id = namespace.idFromName(route.pairingId);
		const stub = namespace.get(id);
		const internalRequest = new Request("https://remote-pair-room.internal/connect", {
			headers: {
				Upgrade: "websocket",
				...(desktopRoute ? { "X-Vetta-Desktop-Role": desktopRoute.role } : { "X-Vetta-Relay-Role": route.role }),
				"X-Vetta-Credential-Hash": credentialHash,
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

function parseDesktopRoute(
	pathname: string,
): { readonly pairingId: string; readonly role: "host" | "viewer" } | undefined {
	const match = /^\/v1\/desktop\/([A-Za-z0-9_-]{24,128})\/(host|viewer)$/.exec(pathname);
	if (!match?.[1] || (match[2] !== "host" && match[2] !== "viewer")) return undefined;
	return { pairingId: match[1], role: match[2] };
}
