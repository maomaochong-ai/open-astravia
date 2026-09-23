import { renderFormula } from "./math-render";

globalThis.onmessage = (event: MessageEvent<unknown>) => {
	const request = event.data;
	if (
		!request ||
		typeof request !== "object" ||
		!("id" in request) ||
		!("source" in request) ||
		!("display" in request)
	)
		return;
	if (typeof request.id !== "number" || typeof request.source !== "string" || typeof request.display !== "boolean")
		return;
	globalThis.postMessage({ id: request.id, html: renderFormula(request.source, request.display) });
};
