import { net } from "electron";

type ElectronNet = Pick<typeof net, "request">;

function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

function headersFromElectron(values: Record<string, string | string[]>): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(values)) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
		} else {
			headers.set(name, value);
		}
	}
	return headers;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function hasResponseBody(method: string, status: number): boolean {
	return method !== "HEAD" && status !== 204 && status !== 205 && status !== 304;
}

/**
 * Electron's net.fetch rejects `redirect: "manual"` instead of returning the
 * redirect response. This adapter restores the Fetch contract on top of
 * net.request so the policy layer can validate every redirect before issuing
 * the next request.
 */
export function createElectronManualRedirectFetch(electronNet: ElectronNet): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const webRequest = new Request(input, init);
		if (webRequest.redirect !== "manual") {
			throw new Error("Electron plugin network transport requires manual redirect mode");
		}
		if (webRequest.signal.aborted) throw abortReason(webRequest.signal);

		const upload = webRequest.body ? Buffer.from(await webRequest.arrayBuffer()) : undefined;
		return new Promise<Response>((resolve, reject) => {
			let settled = false;
			const request = electronNet.request({
				url: webRequest.url,
				method: webRequest.method,
				headers: headersToRecord(webRequest.headers),
				redirect: "manual",
				credentials: "omit",
			});

			const cleanupSignal = (): void => webRequest.signal.removeEventListener("abort", onAbort);
			const rejectOnce = (error: Error): void => {
				if (settled) return;
				settled = true;
				cleanupSignal();
				reject(error);
			};
			const onAbort = (): void => {
				request.abort();
				rejectOnce(abortReason(webRequest.signal));
			};

			webRequest.signal.addEventListener("abort", onAbort, { once: true });
			request.on("redirect", (statusCode, _method, redirectUrl, responseHeaders) => {
				if (settled) return;
				settled = true;
				cleanupSignal();
				const headers = headersFromElectron(responseHeaders);
				headers.set("location", redirectUrl);
				resolve(new Response(null, { status: statusCode, headers }));
			});
			request.on("response", (incoming) => {
				if (settled) return;
				settled = true;
				const finish = (): void => cleanupSignal();
				const body = hasResponseBody(webRequest.method, incoming.statusCode)
					? new ReadableStream<Uint8Array>({
							start(controller) {
								incoming.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
								incoming.once("end", () => {
									finish();
									controller.close();
								});
								incoming.once("aborted", () => {
									finish();
									controller.error(new DOMException("The response was aborted", "AbortError"));
								});
								incoming.once("error", (error) => {
									finish();
									controller.error(error);
								});
							},
							cancel() {
								finish();
								request.abort();
							},
						})
					: null;
				if (body === null) {
					incoming.once("end", finish);
					incoming.once("aborted", finish);
					incoming.once("error", finish);
				}
				resolve(
					new Response(body, {
						status: incoming.statusCode,
						statusText: incoming.statusMessage,
						headers: headersFromElectron(incoming.headers),
					}),
				);
			});
			request.on("error", rejectOnce);
			request.end(upload);
		});
	};
}

export const electronManualRedirectFetch = createElectronManualRedirectFetch(net);
