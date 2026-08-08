import { BedrockRuntimeClient, type BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockOptions } from "./options.js";

export async function createBedrockClient(options: BedrockOptions): Promise<BedrockRuntimeClient> {
	const config: BedrockRuntimeClientConfig = { region: options.region, profile: options.profile };
	if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
		config.region = config.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
		if (process.env.AWS_BEDROCK_SKIP_AUTH === "1") {
			config.credentials = { accessKeyId: "dummy-access-key", secretAccessKey: "dummy-secret-key" };
		}
		if (hasProxyEnvironment()) {
			const nodeHttpHandler = await import("@smithy/node-http-handler");
			const proxyAgent = await import("proxy-agent");
			const agent = new proxyAgent.ProxyAgent();
			config.requestHandler = new nodeHttpHandler.NodeHttpHandler({ httpAgent: agent, httpsAgent: agent });
		} else if (process.env.AWS_BEDROCK_FORCE_HTTP1 === "1") {
			const nodeHttpHandler = await import("@smithy/node-http-handler");
			config.requestHandler = new nodeHttpHandler.NodeHttpHandler();
		}
	}
	config.region = config.region || "us-east-1";
	return new BedrockRuntimeClient(config);
}

function hasProxyEnvironment(): boolean {
	return Boolean(
		process.env.HTTP_PROXY ||
			process.env.HTTPS_PROXY ||
			process.env.NO_PROXY ||
			process.env.http_proxy ||
			process.env.https_proxy ||
			process.env.no_proxy,
	);
}
