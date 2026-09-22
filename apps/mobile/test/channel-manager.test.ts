import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelManager } from "../src/remote/channel-manager";
import type { DesktopRecord } from "../src/remote/types";
import { FakeDesktop, makeLink } from "./helpers";

function desktopRecord(desktop: FakeDesktop, overrides: Partial<DesktopRecord> = {}): DesktopRecord {
	return {
		desktopIdentityKey: desktop.identityKey,
		desktopName: "MacBook Pro",
		pairingId: "pair-1234567890abcdef",
		mobileSecret: "secret-1234567890abcdef",
		lanEndpoints: ["192.168.1.20:43117"],
		relayBaseUrl: "wss://relay.example",
		lastEventSequence: 0,
		pairedAt: 0,
		lastSeenAt: 0,
		...overrides,
	};
}

describe("ChannelManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("prefers the LAN when it answers", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop),
			link,
			createTransport: desktop.createTransport,
		});
		manager.start();
		await vi.advanceTimersByTimeAsync(50);
		expect(manager.getSnapshot()).toMatchObject({ status: "online", channel: "lan", peerOnline: true });
		expect(desktop.opened.some((url) => url.includes("/v2/relay/"))).toBe(false);
		await manager.stop();
	});

	it("falls back to the relay when no LAN endpoint answers, then switches back silently", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		desktop.unreachable.add("ws://192.168.1.20:43117");
		await desktop.connectRelay("pair-1234567890abcdef");
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop),
			link,
			createTransport: desktop.createTransport,
			lanBudgetMs: 200,
			lanProbeIntervalMs: 1_000,
		});
		const seen: string[] = [];
		manager.subscribe((snapshot) => seen.push(`${snapshot.status}:${snapshot.channel}`));
		manager.start();
		await vi.advanceTimersByTimeAsync(300);
		expect(manager.getSnapshot()).toMatchObject({ status: "online", channel: "relay" });

		desktop.unreachable.clear();
		await vi.advanceTimersByTimeAsync(1_100);
		expect(manager.getSnapshot()).toMatchObject({ status: "online", channel: "lan" });
		expect(seen.filter((entry) => entry.startsWith("offline")).length).toBe(0);
		expect(desktop.relayDesktop?.getSnapshot().peerDeviceId).toBe("phone-1");
		await manager.stop();
	});

	it("keeps one continuous event sequence across a channel switch and reports it", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		desktop.unreachable.add("ws://192.168.1.20:43117");
		const relayDesktop = await desktop.connectRelay("pair-1234567890abcdef");
		const sequences: number[] = [];
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop),
			link,
			createTransport: desktop.createTransport,
			lanBudgetMs: 200,
			lanProbeIntervalMs: 1_000,
			onSequence: (sequence) => sequences.push(sequence),
		});
		const names: string[] = [];
		manager.onEvent((event) => names.push(`${event.sequence}:${event.name}`));
		manager.start();
		await vi.advanceTimersByTimeAsync(300);
		await relayDesktop.emitEvent("session.state", { status: "running" }, "s1");
		await relayDesktop.emitEvent("session.message", { kind: "assistant_delta", text: "a" }, "s1");
		await vi.advanceTimersByTimeAsync(20);
		expect(names).toEqual(["1:session.state", "2:session.message"]);

		desktop.unreachable.clear();
		await vi.advanceTimersByTimeAsync(1_100);
		expect(manager.getSnapshot().channel).toBe("lan");
		const lan = desktop.onlineAcceptor();
		expect(lan).toBeDefined();
		// FakeTransport delivery is timer-driven: do not await under fake timers.
		void lan!.emitEvent("session.message", { kind: "assistant_delta", text: "b" }, "s1");
		await vi.advanceTimersByTimeAsync(20);
		expect(names).toEqual(["1:session.state", "2:session.message", "3:session.message"]);
		expect(sequences.at(-1)).toBe(3);
		expect(manager.sequence).toBe(3);
		await manager.stop();
	});

	it("resumes from the persisted sequence so the desktop replays only the missed tail", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		// Desktop journaled 3 events while the phone was away; the phone saw 1.
		for (let index = 0; index < 3; index += 1) {
			desktop.journal.remember({
				type: "event",
				eventId: `e${index + 1}`,
				sequence: desktop.journal.nextSequence(),
				name: "session.state",
				payload: { status: "running" },
				sessionId: "s1",
			});
		}
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop, { lastEventSequence: 1 }),
			link,
			createTransport: desktop.createTransport,
		});
		const received: number[] = [];
		manager.onEvent((event) => received.push(event.sequence));
		manager.start();
		await vi.advanceTimersByTimeAsync(50);
		expect(received).toEqual([2, 3]);
		await manager.stop();
	});

	it("rejects requests while offline and reconnects with backoff after the desktop drops", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop, { relayBaseUrl: undefined }),
			link,
			createTransport: desktop.createTransport,
			lanBudgetMs: 100,
		});
		manager.start();
		await vi.advanceTimersByTimeAsync(50);
		expect(manager.getSnapshot().status).toBe("online");
		const acceptor = desktop.onlineAcceptor()!;
		await acceptor.close();
		await vi.advanceTimersByTimeAsync(5);
		expect(manager.getSnapshot().status).toBe("offline");
		await expect(manager.request("session.list")).rejects.toThrow(/offline/);

		await vi.advanceTimersByTimeAsync(1_100);
		expect(manager.getSnapshot().status).toBe("online");
		expect(desktop.acceptors.length).toBeGreaterThanOrEqual(2);
		await manager.stop();
	});

	it("updates cached LAN endpoints from device.status", async () => {
		const link = makeLink();
		const desktop = new FakeDesktop({ mobileIdentityKey: link.identity.publicKey });
		const endpoints: string[][] = [];
		const manager = new ChannelManager({
			desktop: desktopRecord(desktop),
			link,
			createTransport: desktop.createTransport,
			onLanEndpoints: (list) => endpoints.push([...list]),
		});
		manager.start();
		await vi.advanceTimersByTimeAsync(50);
		void desktop.onlineAcceptor()!.emitEvent("device.status", {
			deviceName: "MacBook Pro",
			lanEndpoints: ["10.0.0.5:43117"],
			relayEnabled: true,
			runningSessionCount: 2,
		});
		await vi.advanceTimersByTimeAsync(20);
		expect(endpoints).toEqual([["10.0.0.5:43117"]]);
		expect(manager.getSnapshot().desktop?.runningSessionCount).toBe(2);
		await manager.stop();
	});
});
