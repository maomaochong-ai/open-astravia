import { afterEach, describe, expect, it, vi } from "vitest";
import { FaviconService } from "./favicon-service.js";

const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./public-resource.js", () => ({ readPublicResource: transport.read }));
afterEach(() => {
	vi.restoreAllMocks();
	transport.read.mockReset();
});

describe("Favicon loading budgets", () => {
	it("deduplicates origins, follows a declared icon, caches it, then refreshes after expiry", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(0);
		transport.read.mockImplementation(async (url: URL) =>
			url.pathname === "/"
				? { url, body: Buffer.from('<link rel="icon" href="/brand.png">'), type: "text/html" }
				: { url, body: Buffer.from("icon"), type: "image/png" },
		);
		const service = new FaviconService();
		const [first, duplicate] = await Promise.all([
			service.resolve("https://example.test/private?a=secret"),
			service.resolve("https://example.test/other"),
		]);
		expect(first).toBe("data:image/png;base64,aWNvbg==");
		expect(duplicate).toBe(first);
		expect(transport.read.mock.calls.map(([url]) => url.href)).toEqual([
			"https://example.test/",
			"https://example.test/brand.png",
		]);
		await service.resolve("https://example.test/third");
		expect(transport.read).toHaveBeenCalledTimes(2);
		now.mockReturnValue(3_600_001);
		await service.resolve("https://example.test");
		expect(transport.read).toHaveBeenCalledTimes(4);
	});
	it("bounds concurrent requests and retains negative cache for missing icons", async () => {
		const releases: Array<() => void> = [];
		transport.read.mockImplementation(
			() => new Promise((_resolve, reject) => releases.push(() => reject(new Error("offline")))),
		);
		const service = new FaviconService();
		const requests = Array.from({ length: 8 }, (_, index) => service.resolve(`https://site${index}.test`));
		expect(transport.read).toHaveBeenCalledTimes(4);
		// Release the real transport boundary; each origin then tries its conventional icon.
		transport.read.mockRejectedValue(new Error("offline"));
		for (const release of releases) release();
		expect(await Promise.all(requests)).toEqual(Array(8).fill(null));
		const count = transport.read.mock.calls.length;
		await service.resolve("https://site0.test");
		expect(transport.read).toHaveBeenCalledTimes(count);
	});
});
