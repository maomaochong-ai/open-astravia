import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { readHttpJson } from "./ui-verification-http";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("readHttpJson", () => {
  test("does not retain a server keep-alive connection after reading JSON", async () => {
    const server = createServer((_request, response) => {
      const body = JSON.stringify([{ type: "page" }]);
      response.writeHead(200, {
        "content-length": Buffer.byteLength(body),
        connection: "keep-alive",
        "content-type": "application/json",
      });
      response.end(body);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

    await expect(readHttpJson(`http://127.0.0.1:${address.port}/json/list`)).resolves.toEqual([
      { type: "page" },
    ]);
    expect(server.closeIdleConnections).toBeTypeOf("function");
  });

  test("fails within the requested timeout", async () => {
    const server = createServer(() => undefined);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

    await expect(readHttpJson(`http://127.0.0.1:${address.port}/json/list`, 50)).rejects.toThrow(
      "Timed out after 50ms",
    );
  });
});
