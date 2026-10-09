import type { RemoteControlConfig, RemoteControlDeviceRecord } from "../config/desktop-config-store.js";

export function pairingIdOf(device: RemoteControlDeviceRecord): string {
	return device.pairingId ?? device.id;
}

/** Device policy is independent of transport and credential-vault side effects. */
export function completeDevicePairing(
	current: RemoteControlConfig,
	pairingId: string,
	identityKey: string,
	name: string | undefined,
	now: number,
): { config: RemoteControlConfig; device: RemoteControlDeviceRecord; retired: string[] } {
	const pending = current.pendingPairings?.find((entry) => entry.pairingId === pairingId);
	if (!pending || pending.expiresAt <= now) throw new Error("pairing is no longer available");
	if (pending.mobileIdentityKey && pending.mobileIdentityKey !== identityKey)
		throw new Error("pairing identity changed");
	const replaced = current.devices.filter((device) => device.mobileIdentityKey === identityKey);
	const target = [...replaced].sort((a, b) => a.createdAt - b.createdAt)[0];
	const renamed = target?.renamed ? target : replaced.find((device) => device.renamed);
	const device: RemoteControlDeviceRecord = {
		id: target?.id ?? pairingId,
		pairingId,
		pairedAt: now,
		name: renamed?.name ?? target?.name ?? name?.trim() ?? pairingId,
		...(renamed ? { renamed: true } : {}),
		...(replaced.some((entry) => entry.desktopControl === false) ? { desktopControl: false } : {}),
		...(target?.screenOnDemand ? { screenOnDemand: true } : {}),
		mobileSecretHash: pending.mobileSecretHash,
		mobileIdentityKey: identityKey,
		createdAt: target?.createdAt ?? now,
		lastSeenAt: now,
	};
	return {
		device,
		retired: replaced.map(pairingIdOf).filter((id) => id !== pairingId),
		config: {
			...current,
			devices: [...current.devices.filter((entry) => !replaced.includes(entry)), device],
			pendingPairings: current.pendingPairings?.filter((entry) => entry.pairingId !== pairingId),
			retiredPairingIds: [
				...new Set([
					...(current.retiredPairingIds ?? []),
					...replaced.map(pairingIdOf).filter((id) => id !== pairingId),
				]),
			],
		},
	};
}

/** Keep the newest credentials but the oldest device identity and restrictive permissions. */
export function restoreDevicePairings(current: RemoteControlConfig): {
	config: RemoteControlConfig;
	retired: string[];
} {
	const groups = new Map<string, RemoteControlDeviceRecord[]>();
	const retired = [
		...(current.retiredPairingIds ?? []),
		...(current.pendingPairings ?? []).map((pending) => pending.pairingId),
	];
	for (const device of current.devices) {
		if (!device.mobileIdentityKey) {
			retired.push(pairingIdOf(device));
			continue;
		}
		const group = groups.get(device.mobileIdentityKey) ?? [];
		group.push(device);
		groups.set(device.mobileIdentityKey, group);
	}
	const devices = [...groups.values()].map((group) => {
		const oldest = [...group].sort((a, b) => a.createdAt - b.createdAt)[0]!;
		const newest = [...group].sort((a, b) => (b.pairedAt ?? b.createdAt) - (a.pairedAt ?? a.createdAt))[0]!;
		const renamed = oldest.renamed ? oldest : group.find((device) => device.renamed);
		retired.push(...group.filter((device) => pairingIdOf(device) !== pairingIdOf(newest)).map(pairingIdOf));
		return {
			...newest,
			id: oldest.id,
			pairingId: pairingIdOf(newest),
			createdAt: oldest.createdAt,
			...(renamed ? { name: renamed.name, renamed: true } : {}),
			...(group.some((device) => device.desktopControl === false) ? { desktopControl: false } : {}),
		};
	});
	return {
		config: {
			...current,
			devices,
			pendingPairings: undefined,
			retiredPairingIds: retired.length ? [...new Set(retired)] : undefined,
		},
		retired,
	};
}
