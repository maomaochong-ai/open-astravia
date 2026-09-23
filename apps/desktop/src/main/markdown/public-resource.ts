import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address: string): boolean {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}

/** Pin the validated DNS result to the socket; checking before ordinary fetch permits DNS rebinding. */
export async function readPublicResource(
	url: URL,
	limit: number,
	signal: AbortSignal,
	redirects = 0,
): Promise<{ body: Buffer; type: string; url: URL }> {
	if (
		!/^https?:$/.test(url.protocol) ||
		url.username ||
		url.password ||
		(url.port && !["80", "443"].includes(url.port))
	)
		throw new Error("Unsupported public resource");
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	signal.throwIfAborted();
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(new Error("Resource request cancelled"));
		signal.addEventListener("abort", abort, { once: true });
	});
	const addresses = await Promise.race([lookup(hostname, { all: true }), cancelled]).finally(() =>
		signal.removeEventListener("abort", abort),
	);
	if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
		throw new Error("Non-public resource");
	if (signal.aborted) throw new Error("Resource request timed out");
	const address = addresses[0];
	return new Promise((resolve, reject) => {
		const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
			url,
			{
				signal,
				agent: false,
				headers: { Accept: "text/html,image/*", "Accept-Encoding": "identity" },
				lookup: (_hostname, options, callback) => {
					if (options.all) callback(null, [address]);
					else callback(null, address.address, address.family);
				},
			},
			(response) => {
				if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
					response.destroy();
					if (!response.headers.location || redirects >= 3) {
						reject(new Error("Resource redirect limit"));
						return;
					}
					try {
						resolve(readPublicResource(new URL(response.headers.location, url), limit, signal, redirects + 1));
					} catch (error) {
						reject(error);
					}
					return;
				}
				if (response.statusCode !== 200) {
					response.destroy();
					reject(new Error("Resource unavailable"));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				response.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > limit) response.destroy(new Error("Resource too large"));
					else chunks.push(chunk);
				});
				response.on("error", reject);
				response.on("end", () =>
					resolve({ body: Buffer.concat(chunks), type: response.headers["content-type"] ?? "", url }),
				);
			},
		);
		request.on("error", reject);
		request.end();
	});
}
