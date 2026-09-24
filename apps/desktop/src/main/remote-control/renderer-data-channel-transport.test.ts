import type { RemoteFrame } from "@vetta/remote-control";
import { describe, expect, it, vi } from "vitest";
import { RendererDataChannelTransport } from "./renderer-data-channel-transport.js";

const hello: RemoteFrame = {
	type: "hello",
	protocolVersion: 2,
	role: "mobile",
	deviceId: "phone",
	deviceName: "Phone",
	capabilities: { chat: true, sessionRead: true },
	connectionId: "connection-1",
	identityKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	ephemeralKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
};

describe("RendererDataChannelTransport", () => {
	it("queues an early frame, then sends validated protocol frames", async () => {
		const port = { send: vi.fn(), close: vi.fn() };
		const transport = new RendererDataChannelTransport(port);
		transport.handleOpen();
		transport.handleMessage(JSON.stringify(hello));
		const received: RemoteFrame[] = [];
		await transport.connect({ onFrame: (frame) => received.push(frame), onClose: vi.fn() });
		expect(received).toEqual([hello]);

		await transport.send(hello);
		expect(port.send).toHaveBeenCalledWith(`${JSON.stringify(hello)}\n`);
	});

	it("closes the channel when the renderer sends an invalid frame", async () => {
		const port = { send: vi.fn(), close: vi.fn() };
		const onClose = vi.fn();
		const transport = new RendererDataChannelTransport(port);
		await transport.connect({ onFrame: vi.fn(), onClose });
		transport.handleOpen();
		transport.handleMessage("not-json");
		expect(port.close).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledWith("invalid control data channel frame");
		await expect(transport.send(hello)).rejects.toThrow("not open");
	});
});
