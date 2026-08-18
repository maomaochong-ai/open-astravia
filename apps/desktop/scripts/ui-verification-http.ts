import { get } from "node:http";

const maximumResponseBytes = 2 * 1024 * 1024;

export function readHttpJson(url: string, timeoutMs = 2_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        agent: false,
        headers: { connection: "close" },
      },
      (response) => {
        if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode ?? "unknown"}`));
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
            request.destroy(new Error("HTTP JSON response exceeded 2 MiB"));
          }
        });
        response.once("end", () => {
          try {
            resolve(JSON.parse(body) as unknown);
          } catch (error) {
            reject(error);
          }
        });
        response.once("error", reject);
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms requesting ${url}`));
    });
    request.once("error", reject);
  });
}
