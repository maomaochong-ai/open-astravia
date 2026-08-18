export function createClient(callback: (error: Error) => void): void {
	callback(new Error("x11 DBus address discovery is not available in the packaged app"));
}

export default { createClient };
