import { describe, expect, it } from "vitest";
import {
	buildPairingUri,
	generateIdentityKeyPair,
	lanControlUrl,
	normalizeRelayBaseUrl,
	parsePairingUri,
	RemoteProtocolError,
	randomToken,
	relayControlUrl,
	toBase64Url,
} from "../src/index.js";

const invite = {
	version: 2,
	pairingId: randomToken(24),
	mobileSecret: randomToken(32),
	desktopIdentityKey: toBase64Url(generateIdentityKeyPair().publicKey),
	desktopName: "MacBook Pro",
	lanEndpoints: ["192.168.1.20:43117", "[fe80::1%en0]:43117"],
	relayBaseUrl: "wss://relay.example.com",
} as const;

describe("pairing uri", () => {
	it("round-trips an invite through the vetta://pair link", () => {
		const uri = buildPairingUri(invite);
		expect(uri.startsWith("vetta://pair?")).toBe(true);
		expect(parsePairingUri(uri)).toEqual(invite);
	});

	it("omits the relay when cloud access is off", () => {
		const { relayBaseUrl: _relay, ...local } = invite;
		expect(parsePairingUri(buildPairingUri(local))).toEqual(local);
	});

	it("rejects foreign links, old versions and malformed fields", () => {
		expect(() => parsePairingUri("https://example.com/pair?v=2")).toThrow(RemoteProtocolError);
		expect(() => parsePairingUri(buildPairingUri(invite).replace("v=2", "v=1"))).toThrow(RemoteProtocolError);
		expect(() => parsePairingUri(buildPairingUri({ ...invite, desktopIdentityKey: "nope" }))).toThrow(
			RemoteProtocolError,
		);
		expect(() => parsePairingUri(buildPairingUri({ ...invite, lanEndpoints: ["nohost"] }))).toThrow(
			RemoteProtocolError,
		);
		expect(() => parsePairingUri(buildPairingUri({ ...invite, mobileSecret: "short" }))).toThrow(RemoteProtocolError);
	});

	it("normalizes relay base URLs and builds control URLs", () => {
		expect(normalizeRelayBaseUrl("https://relay.example.com/")).toBe("wss://relay.example.com");
		expect(normalizeRelayBaseUrl("http://localhost:8787")).toBe("ws://localhost:8787");
		expect(normalizeRelayBaseUrl("ftp://x")).toBeUndefined();
		expect(relayControlUrl("wss://relay.example.com", "abc", "mobile")).toBe(
			"wss://relay.example.com/v2/relay/abc/mobile",
		);
		expect(lanControlUrl("192.168.1.20:43117", "abc")).toBe("ws://192.168.1.20:43117/v2/lan/abc");
	});
});
