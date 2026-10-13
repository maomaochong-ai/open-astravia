import { appendFileSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { isDirectRun, repoRoot } from "../quality/lib.mjs";

const SIGNING_VARIABLES = [
	"VETTA_ANDROID_KEYSTORE_BASE64",
	"VETTA_ANDROID_KEYSTORE_PASSWORD",
	"VETTA_ANDROID_KEY_ALIAS",
	"VETTA_ANDROID_KEY_PASSWORD",
];

function gradleProperty(properties, name) {
	const matches = [...properties.matchAll(new RegExp(`^\\s*${name}[ \\t]*=[ \\t]*([^\\r\\n]*)`, "gm"))];
	if (matches.length !== 1) throw new Error(`Android gradle.properties must declare ${name} exactly once.`);
	return matches[0][1].trim();
}

export function parseAndroidVersion(properties) {
	const versionName = gradleProperty(properties, "vettaAndroidVersionName");
	const code = gradleProperty(properties, "vettaAndroidVersionCode");
	if (!versionName || /[\\\\\r\n]/.test(versionName)) throw new Error("Invalid Android versionName.");
	const versionCode = Number(code);
	if (!/^[1-9]\d*$/.test(code) || !Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000) {
		throw new Error("Invalid Android versionCode.");
	}
	return { versionName, versionCode };
}

export function parseAndroidReleaseConfig(properties) {
	const abi = gradleProperty(properties, "vettaAndroidAbi");
	if (abi !== "arm64-v8a") {
		throw new Error("Invalid Android release ABI configuration.");
	}
	return { ...parseAndroidVersion(properties), abi };
}

export function readAndroidReleaseConfig() {
	return parseAndroidReleaseConfig(
		readFileSync(join(repoRoot, "apps/mobile/client-android/gradle.properties"), "utf8"),
	);
}

export function prepareAndroidRelease(env, config = readAndroidReleaseConfig()) {
	const missing = SIGNING_VARIABLES.filter((name) => !env[name]);
	if (missing.length > 0) throw new Error(`Missing Android signing secrets: ${missing.join(", ")}`);
	if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) || /[\r\n]/.test(env.RUNNER_TEMP)) {
		throw new Error("RUNNER_TEMP must be an absolute single-line path.");
	}
	const encoded = env.VETTA_ANDROID_KEYSTORE_BASE64.replace(/\s/g, "");
	const keystore = Buffer.from(encoded, "base64");
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || keystore.toString("base64") !== encoded) {
		throw new Error("VETTA_ANDROID_KEYSTORE_BASE64 is not valid base64.");
	}
	const signingDirectory = mkdtempSync(join(env.RUNNER_TEMP, "android-signing-"));
	const keystorePath = join(signingDirectory, "release.jks");
	writeFileSync(keystorePath, keystore, { mode: 0o600 });
	return {
		VETTA_ANDROID_KEYSTORE_PATH: keystorePath,
		VETTA_ANDROID_APK_PATH: join(env.RUNNER_TEMP, "android-release", `Vetta-${config.abi}.apk`),
	};
}

export function stageAndroidApk(directory, env, config = readAndroidReleaseConfig()) {
	const { versionName, versionCode, abi } = config;
	const metadata = JSON.parse(readFileSync(join(directory, "output-metadata.json"), "utf8"));
	const element = metadata?.elements?.[0];
	if (
		!metadata ||
		metadata.applicationId !== "org.vetta.android" ||
		metadata.variantName !== "release" ||
		!Array.isArray(metadata.elements) ||
		metadata.elements.length !== 1 ||
		!element ||
		!Array.isArray(element.filters) ||
		element.filters.length !== 1 ||
		element.filters[0]?.filterType !== "ABI" ||
		element.filters[0].value !== abi ||
		element.versionName !== versionName ||
		element.versionCode !== versionCode ||
		typeof element.outputFile !== "string" ||
		basename(element.outputFile) !== element.outputFile ||
		!element.outputFile.endsWith(".apk")
	) {
		throw new Error("Android APK metadata does not match the Android version or architecture configuration.");
	}
	const destination = join(env.RUNNER_TEMP, "android-release", `Vetta-${abi}.apk`);
	if (env.VETTA_ANDROID_APK_PATH !== destination) throw new Error("Unexpected Android release APK destination.");
	const source = join(directory, element.outputFile);
	if (!lstatSync(source).isFile()) throw new Error("Android release APK is not a regular file.");
	mkdirSync(join(env.RUNNER_TEMP, "android-release"), { recursive: true });
	copyFileSync(source, destination);
	return destination;
}

if (isDirectRun(import.meta.url)) {
	try {
		const args = process.argv.slice(2);
		if (args[0] === "--stage-apk" && args.length === 2) {
			console.log(`Android APK staged: ${stageAndroidApk(resolve(args[1]), process.env)}`);
		} else if (args.length === 0) {
			if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required to prepare an Android release.");
			const values = prepareAndroidRelease(process.env);
			appendFileSync(
				process.env.GITHUB_ENV,
				`${Object.entries(values)
					.map(([key, value]) => `${key}=${value}`)
					.join("\n")}\n`,
			);
			console.log("Android release signing prepared.");
		} else {
			throw new Error("Usage: prepare-android-release.mjs [--stage-apk <directory>]");
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
