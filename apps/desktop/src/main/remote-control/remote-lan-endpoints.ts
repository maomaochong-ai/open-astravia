import { networkInterfaces } from "node:os";

interface AddressInfo {
	readonly address: string;
	readonly family: string | number;
	readonly internal: boolean;
}

/**
 * `host:port` candidates a phone on the same network can try, most likely
 * first. Only IPv4: iOS treats every IPv6 link-local hop as a separate
 * local-network permission prompt, and the Wi-Fi networks people actually
 * pair on hand out RFC 1918 addresses.
 */
export function listLanEndpoints(
	port: number,
	interfaces: Record<string, readonly AddressInfo[] | undefined> = networkInterfaces(),
): string[] {
	const addresses: Array<{ address: string; rank: number }> = [];
	for (const [name, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.internal) continue;
			if (entry.family !== "IPv4" && entry.family !== 4) continue;
			if (entry.address.startsWith("169.254.")) continue;
			addresses.push({ address: entry.address, rank: rankInterface(name, entry.address) });
		}
	}
	return addresses
		.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address))
		.map((entry) => `${entry.address}:${port}`);
}

function rankInterface(name: string, address: string): number {
	// Virtual adapters (Docker bridges, VPN tunnels, VM host-only networks)
	// carry addresses a phone can never reach; keep them but try them last.
	if (/^(docker|br-|veth|utun|tun|tap|vmnet|vboxnet|zt|tailscale|wg)/i.test(name)) return 3;
	if (address.startsWith("192.168.")) return 0;
	if (address.startsWith("10.")) return 1;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
	return 2;
}
