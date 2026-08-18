function importNewSessionPage() {
	return import("./NewSessionPage").then((module) => ({ default: module.NewSessionPage }));
}

let newSessionPagePromise: ReturnType<typeof importNewSessionPage> | null = null;

export function loadNewSessionPage(): ReturnType<typeof importNewSessionPage> {
	newSessionPagePromise ??= importNewSessionPage();
	return newSessionPagePromise;
}
