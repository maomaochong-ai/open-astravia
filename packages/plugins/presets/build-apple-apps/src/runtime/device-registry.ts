/**
 * `baguette list` 输出解析与默认设备挑选。纯函数，不碰进程和 UI。
 *
 * 输出是 NDJSON（每行一个设备对象）而不是 JSON 数组，所以按行解析：
 * 坏行跳过，不让一行脏数据废掉整张设备表。
 */

export interface SimulatorDevice {
	readonly udid: string;
	readonly name: string;
	readonly state: string;
	readonly runtime: string;
}

/** 没有指定默认设备时优先挑的机型，按顺序匹配。 */
const PREFERRED_NAMES = ["iPhone 17 Pro", "iPhone 17"] as const;

/** 设备是否已启动。baguette 与 simctl 都用 "Booted"。 */
export function isBooted(device: SimulatorDevice): boolean {
	return device.state === "Booted";
}

function toDevice(value: unknown): SimulatorDevice | null {
	if (typeof value !== "object" || value === null) return null;
	const { udid, name, state, runtime } = value as Record<string, unknown>;
	if (typeof udid !== "string" || udid.length === 0) return null;
	if (typeof name !== "string" || typeof state !== "string" || typeof runtime !== "string") return null;
	return { udid, name, state, runtime };
}

/** 解析 NDJSON 设备列表。非 JSON 行（进度、警告）不是错误，直接跳过。 */
export function parseDeviceList(stdout: string): SimulatorDevice[] {
	const devices: SimulatorDevice[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const device = toDevice(JSON.parse(trimmed));
			if (device) devices.push(device);
		} catch {
			continue;
		}
	}
	return devices;
}

/**
 * 面板要直接进入哪台设备：
 * 1. 用户在配置里指定的那台（仍在列表里）
 * 2. 任何已启动的设备——不要为了机型偏好去动用户已经在用的环境
 * 3. 偏好机型（iPhone 17 Pro，其次 iPhone 17 系列）
 * 4. 任何 iPhone
 * 5. 列表第一台
 */
export function selectPreferredDevice(
	devices: readonly SimulatorDevice[],
	preferredUdid: string | null,
): SimulatorDevice | null {
	if (devices.length === 0) return null;
	const pinned = preferredUdid === null ? undefined : devices.find((device) => device.udid === preferredUdid);
	if (pinned) return pinned;

	const booted = devices.find(isBooted);
	if (booted) return booted;

	for (const name of PREFERRED_NAMES) {
		const exact = devices.find((device) => device.name === name);
		if (exact) return exact;
		const prefixed = devices.find((device) => device.name.startsWith(name));
		if (prefixed) return prefixed;
	}
	return devices.find((device) => device.name.startsWith("iPhone")) ?? devices[0];
}
