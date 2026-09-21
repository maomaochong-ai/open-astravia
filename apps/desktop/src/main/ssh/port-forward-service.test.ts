import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PortForwardConnection, SshPortForwardService } from "./port-forward-service.js";

vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./ssh-events.js", () => ({ broadcastSshPortForwards: vi.fn() }));
vi.mock("./ssh-runtime.js", () => ({ getSshConnection: vi.fn() }));

/** 一台假主机：记录收到的转发请求，并按脚本决定哪一次失败。 */
function createConnection(): PortForwardConnection & {
	forwarded: { localPort: number; remotePort: number }[];
	cancelled: { localPort: number; remotePort: number }[];
	failWith?: Error;
} {
	const connection = {
		forwarded: [] as { localPort: number; remotePort: number }[],
		cancelled: [] as { localPort: number; remotePort: number }[],
		failWith: undefined as Error | undefined,
		forwardPort: async (localPort: number, remotePort: number) => {
			if (connection.failWith) throw connection.failWith;
			connection.forwarded.push({ localPort, remotePort });
		},
		cancelPortForward: async (localPort: number, remotePort: number) => {
			connection.cancelled.push({ localPort, remotePort });
		},
	};
	return connection;
}

describe("远端端口转发的账本", () => {
	let connection: ReturnType<typeof createConnection>;
	/** 本机上被占用的端口。测试直接摆事实，不去真的 bind。 */
	let busyPorts: Set<number>;
	let changes: number;

	function createService(): SshPortForwardService {
		return new SshPortForwardService({
			connect: () => connection,
			isLocalPortBusy: async (port) => busyPorts.has(port),
			allocateLocalPort: async () => 52341,
			onChanged: () => {
				changes += 1;
			},
		});
	}

	beforeEach(() => {
		connection = createConnection();
		busyPorts = new Set();
		changes = 0;
	});

	it("优先用与远端同号的本机端口，被占用时才换号", async () => {
		const service = createService();

		const same = await service.open({ hostId: "host-1", remotePort: 3000 });
		expect(same.localPort).toBe(3000);

		busyPorts.add(5173);
		const moved = await service.open({ hostId: "host-1", remotePort: 5173 });
		expect(moved.localPort).toBe(52341);

		expect(connection.forwarded).toEqual([
			{ localPort: 3000, remotePort: 3000 },
			{ localPort: 52341, remotePort: 5173 },
		]);
		expect(service.list("host-1").map((forward) => forward.remotePort)).toEqual([3000, 5173]);
	});

	it("用户点名的本机端口被占用时如实报错，不偷偷换号", async () => {
		busyPorts.add(8080);
		const service = createService();

		await expect(service.open({ hostId: "host-1", remotePort: 80, localPort: 8080 })).rejects.toThrow(
			/8080 is already in use/,
		);
		expect(service.list()).toEqual([]);
	});

	it("同一个远端端口重复请求时复用已有的转发，不会撤掉正在用的那条", async () => {
		const service = createService();

		const first = await service.open({ hostId: "host-1", remotePort: 3000, source: "manual" });
		const second = await service.open({ hostId: "host-1", remotePort: 3000, source: "plugin" });

		expect(second).toEqual(first);
		expect(connection.forwarded).toHaveLength(1);
		expect(service.list()).toHaveLength(1);
	});

	describe("换本机端口", () => {
		it("换到另一个号上：先接通新的再撤旧的", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 5173 });

			const moved = await service.open({ hostId: "host-1", remotePort: 5173, localPort: 5174 });

			expect(moved.localPort).toBe(5174);
			expect(service.list()).toHaveLength(1);
			expect(connection.forwarded).toEqual([
				{ localPort: 5173, remotePort: 5173 },
				{ localPort: 5174, remotePort: 5173 },
			]);
			// 旧的那条在新的接通之后才撤。
			expect(connection.cancelled).toEqual([{ localPort: 5173, remotePort: 5173 }]);
		});

		it("新端口被占用时原来那条仍然好用——不能在一次改号里把能用的转发弄丢", async () => {
			busyPorts.add(8080);
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 5173 });

			await expect(service.open({ hostId: "host-1", remotePort: 5173, localPort: 8080 })).rejects.toThrow(
				/8080 is already in use/,
			);

			expect(service.list()[0]).toMatchObject({ localPort: 5173, status: "active" });
			expect(connection.cancelled).toEqual([]);
		});

		it("新端口接不通时同样保留原来那条", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 5173 });
			connection.failWith = new Error("bind: Address already in use");

			await expect(service.open({ hostId: "host-1", remotePort: 5173, localPort: 5174 })).rejects.toThrow(/bind/);

			expect(service.list()[0]).toMatchObject({ localPort: 5173, status: "active" });
			expect(connection.cancelled).toEqual([]);
		});

		it("点名的号与现用的相同时什么都不做", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 5173 });

			await service.open({ hostId: "host-1", remotePort: 5173, localPort: 5173 });

			expect(connection.forwarded).toHaveLength(1);
			expect(connection.cancelled).toEqual([]);
		});
	});

	it("转发失败时不进账本，错误原样交给调用方（可能是 AllowTcpForwarding 关着）", async () => {
		const service = createService();
		connection.failWith = new Error("The SSH server may have TCP forwarding disabled (AllowTcpForwarding).");

		await expect(service.open({ hostId: "host-1", remotePort: 3000 })).rejects.toThrow(/AllowTcpForwarding/);
		expect(service.list()).toEqual([]);
	});

	it("撤掉转发时同时清账本与远端的转发；撤不存在的那条什么都不做", async () => {
		const service = createService();
		await service.open({ hostId: "host-1", remotePort: 3000 });

		await service.close("host-1", 3000);

		expect(connection.cancelled).toEqual([{ localPort: 3000, remotePort: 3000 }]);
		expect(service.list()).toEqual([]);
		await expect(service.close("host-1", 3000)).resolves.toBeUndefined();
		expect(connection.cancelled).toHaveLength(1);
	});

	it("端口号不合法时立刻拒绝", async () => {
		const service = createService();
		await expect(service.open({ hostId: "host-1", remotePort: 0 })).rejects.toThrow(/Invalid remote port/);
		await expect(service.open({ hostId: "host-1", remotePort: 70000 })).rejects.toThrow(/Invalid remote port/);
	});

	describe("巡检：转发随 ControlMaster 一起消失后", () => {
		it("本机端口上没人听时重建一次，成功后回到 active", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 3000 });
			busyPorts.add(3000); // 转发建立后端口上有人在听
			await service.verify();
			expect(connection.forwarded).toHaveLength(1); // 还活着，不必动

			busyPorts.delete(3000); // master 退出，转发没了
			await service.verify();

			expect(connection.forwarded).toEqual([
				{ localPort: 3000, remotePort: 3000 },
				{ localPort: 3000, remotePort: 3000 },
			]);
			expect(service.list()[0]).toMatchObject({ status: "active", localPort: 3000 });
		});

		it("重建失败时标成 failed 并带上原因，且不再反复重试（重连会弹口令）", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 3000 });
			connection.failWith = new Error("Connection closed by remote host");

			await service.verify();
			expect(service.list()[0]).toMatchObject({ status: "failed", error: /closed by remote host/ as never });

			const attempts = connection.forwarded.length;
			await service.verify();
			await service.verify();
			expect(connection.forwarded).toHaveLength(attempts);
		});

		it("重建期间用户撤掉了它就不再复活", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 3000 });
			let release = (): void => {};
			let entered = (): void => {};
			const reachedRemote = new Promise<void>((resolve) => {
				entered = resolve;
			});
			connection.forwardPort = () =>
				new Promise<void>((resolve) => {
					release = resolve;
					entered();
				});

			const verifying = service.verify();
			await reachedRemote;
			await service.close("host-1", 3000);
			release();
			await verifying;

			expect(service.list()).toEqual([]);
		});

		it("巡检取快照之后被撤掉的转发不会被重建回来", async () => {
			// 探测本机端口本身是异步的：那一次等待里撤掉的条目不能再进重建。
			let resolveProbe: ((busy: boolean) => void) | undefined;
			const service = new SshPortForwardService({
				connect: () => connection,
				isLocalPortBusy: (port) =>
					resolveProbe === undefined && port === 3000
						? Promise.resolve(false)
						: new Promise<boolean>((resolve) => {
								resolveProbe = resolve;
							}),
				allocateLocalPort: async () => 52341,
			});
			await service.open({ hostId: "host-1", remotePort: 3000, localPort: 3000 });
			const forwardsBefore = connection.forwarded.length;
			resolveProbe = () => {}; // 之后的探测都挂起，由测试决定什么时候答复

			const verifying = service.verify();
			await service.close("host-1", 3000);
			resolveProbe(false);
			await verifying;

			expect(service.list()).toEqual([]);
			expect(connection.forwarded).toHaveLength(forwardsBefore);
		});

		it("每次状态变化都通知界面，包括巡检引起的那些", async () => {
			const service = createService();
			await service.open({ hostId: "host-1", remotePort: 3000 });
			const afterOpen = changes;

			await service.verify();

			// reconnecting 与随后的 active 各算一次：界面要能显示「重连中」。
			expect(changes).toBe(afterOpen + 2);
		});
	});

	it("按主机收掉全部转发", async () => {
		const service = createService();
		await service.open({ hostId: "host-1", remotePort: 3000 });
		await service.open({ hostId: "host-1", remotePort: 3001 });
		await service.open({ hostId: "host-2", remotePort: 4000 });

		await service.closeHost("host-1");

		expect(service.list().map((forward) => forward.hostId)).toEqual(["host-2"]);
	});
});
