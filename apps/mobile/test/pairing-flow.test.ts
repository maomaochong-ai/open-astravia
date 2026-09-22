import { buildPairingUri, toBase64Url } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";
import { PairingFlow, type PairingPhase } from "../src/remote/pairing-flow";
import { FakeDesktop, makeLink } from "./helpers";

function invite(desktop: FakeDesktop, lan = ["192.168.1.20:43117"], relay?: string) {
	return buildPairingUri({
		version: 2,
		pairingId: "pair-1234567890abcdef",
		mobileSecret: "secret-1234567890abcdef",
		desktopIdentityKey: desktop.identityKey,
		desktopName: "MacBook Pro",
		lanEndpoints: lan,
		relayBaseUrl: relay,
	});
}

describe("PairingFlow", () => {
	it("pairs from a scanned QR over the LAN and persists the invite as a desktop record", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ onHello: () => ({ kind: "approve" }) });
		const phases: PairingPhase[] = [];
		const flow = new PairingFlow({
			link,
			createTransport: desktop.createTransport,
			onPhase: (phase) => phases.push(phase),
		});
		const record = await flow.pairWithCode(invite(desktop));
		expect(record).toMatchObject({
			desktopIdentityKey: desktop.identityKey,
			desktopName: "MacBook Pro",
			pairingId: "pair-1234567890abcdef",
			mobileSecret: "secret-1234567890abcdef",
			lanEndpoints: ["192.168.1.20:43117"],
			lastEventSequence: 0,
		});
		expect(phases.map((phase) => phase.kind)).toEqual(["connecting", "paired"]);
	});

	it("falls back to the relay from the invite when the LAN does not answer", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ onHello: () => ({ kind: "approve" }) });
		desktop.unreachable.add("ws://192.168.1.20:43117");
		await desktop.connectRelay("pair-1234567890abcdef");
		const phases: PairingPhase[] = [];
		const flow = new PairingFlow({
			link,
			createTransport: desktop.createTransport,
			onPhase: (phase) => phases.push(phase),
			timeoutMs: 100,
		});
		const record = await flow.pairWithCode(invite(desktop, ["192.168.1.20:43117"], "wss://relay.example"));
		expect(record?.relayBaseUrl).toBe("wss://relay.example");
		expect(
			phases.filter((phase) => phase.kind === "connecting").map((phase) => phase.kind === "connecting" && phase.via),
		).toEqual(["lan", "relay"]);
	});

	it("rejects codes that are not Vetta invites or point at a different identity", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ onHello: () => ({ kind: "approve" }) });
		const phases: PairingPhase[] = [];
		const flow = new PairingFlow({
			link,
			createTransport: desktop.createTransport,
			onPhase: (phase) => phases.push(phase),
			timeoutMs: 100,
		});
		expect(await flow.pairWithCode("https://example.com")).toBeUndefined();
		expect(phases.at(-1)).toEqual({ kind: "failed", reason: "invalid_code" });

		const impostor = new FakeDesktop({ onHello: () => ({ kind: "approve" }) });
		const wrongKey = new PairingFlow({
			link,
			createTransport: impostor.createTransport,
			onPhase: (phase) => phases.push(phase),
			timeoutMs: 100,
		});
		expect(await wrongKey.pairWithCode(invite(desktop))).toBeUndefined();
		expect(phases.at(-1)).toEqual({ kind: "failed", reason: "unauthorized" });
	});

	it("walks the manual path: verification code, desktop approval, credential hand-over", async () => {
		const link = makeLink();
		let approve: (value: boolean) => void = () => undefined;
		const approval = new Promise<boolean>((resolve) => {
			approve = resolve;
		});
		const desktop = new FakeDesktop({ onHello: () => ({ kind: "pending", approval }) });
		const phases: PairingPhase[] = [];
		const flow = new PairingFlow({
			link,
			createTransport: desktop.createTransport,
			onPhase: (phase) => phases.push(phase),
		});
		const pairing = flow.pairManually("192.168.1.20:43117");
		await new Promise((resolve) => setTimeout(resolve, 20));
		const awaiting = phases.find((phase) => phase.kind === "awaiting_approval");
		expect(awaiting?.kind === "awaiting_approval" && awaiting.verificationCode).toMatch(/^\d{6}$/);
		const acceptor = desktop.acceptors[0]!;
		expect(acceptor.getSnapshot().verificationCode).toBe(
			awaiting?.kind === "awaiting_approval" ? awaiting.verificationCode : "",
		);
		expect(desktop.opened[0]).toBe("ws://192.168.1.20:43117/v2/lan/pair");

		approve(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		await acceptor.emitEvent("device.paired", {
			pairingId: "pair-manual-1234567890",
			mobileSecret: "secret-manual-1234567890",
			desktopName: "MacBook Pro",
			lanEndpoints: ["192.168.1.20:43117", "10.0.0.5:43117"],
			relayBaseUrl: "wss://relay.example",
		});
		const record = await pairing;
		expect(record).toMatchObject({
			desktopIdentityKey: toBase64Url(desktop.identity.publicKey),
			pairingId: "pair-manual-1234567890",
			mobileSecret: "secret-manual-1234567890",
			lanEndpoints: ["192.168.1.20:43117", "10.0.0.5:43117"],
			relayBaseUrl: "wss://relay.example",
		});
		expect(phases.at(-1)?.kind).toBe("paired");
	});

	it("reports a rejected manual pairing and an invalid endpoint", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ onHello: () => ({ kind: "pending", approval: Promise.resolve(false) }) });
		const phases: PairingPhase[] = [];
		const flow = new PairingFlow({
			link,
			createTransport: desktop.createTransport,
			onPhase: (phase) => phases.push(phase),
			timeoutMs: 200,
		});
		expect(await flow.pairManually("192.168.1.20:43117")).toBeUndefined();
		expect(phases.at(-1)).toEqual({ kind: "failed", reason: "rejected" });
		expect(await flow.pairManually("not an address")).toBeUndefined();
		expect(phases.at(-1)).toEqual({ kind: "failed", reason: "invalid_endpoint" });
	});
});
