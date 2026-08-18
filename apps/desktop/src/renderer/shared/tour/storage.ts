export function isTourCompleted(storageKey: string): boolean {
	try {
		return localStorage.getItem(storageKey) === "1";
	} catch {
		// Private mode / blocked storage: treat as completed so we do not loop.
		return true;
	}
}

export function markTourCompleted(storageKey: string): void {
	try {
		localStorage.setItem(storageKey, "1");
	} catch {
		// ignore quota / private mode
	}
}
