import * as Device from "expo-device";
import { Platform } from "react-native";
import type { KeyValueStore } from "../types";

const DEVICE_ID_KEY = "vetta.device.id";

export function describeDevice(): string {
	const name = Device.deviceName?.trim();
	if (name) return name.slice(0, 64);
	const model = Device.modelName?.trim();
	if (model) return model.slice(0, 64);
	return Platform.OS === "ios" ? "iPhone" : "Android";
}

/** Stable per-install id used as the protocol `deviceId`. */
export async function loadDeviceId(settings: KeyValueStore, random: () => string): Promise<string> {
	const existing = await settings.get(DEVICE_ID_KEY);
	if (existing) return existing;
	const created = `mobile-${random()}`;
	await settings.set(DEVICE_ID_KEY, created);
	return created;
}
