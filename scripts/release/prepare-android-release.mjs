import { appendFileSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { isDirectRun, repoRoot } from "../quality/lib.mjs";

const SIGNING_VARIABLES = [
	"ASTRAVIA_ANDROID_KEYSTORE_BASE64",
	"ASTRAVIA_ANDROID_KEYSTORE_PASSWORD",
	"ASTRAVIA_ANDROID_KEY_ALIAS",
	"ASTRAVIA_ANDROID_KEY_PASSWORD",
];

function gradleProperty(properties, name) {
	const matches = [...properties.matchAll(new RegExp(`^\\s*${name}[ \\t]*=[ \\t]*([^\\r\\n]*)`, "gm"))];
	if (matches.length !== 1) throw new Error(`Android gradle.properties must declare ${name} exactly once.`);
	return matches[0][1].trim();
}

export function parseAndroidVersion(properties) {
	const versionName = gradleProperty(properties, "astraviaAndroidVersionName");
	const code = gradleProperty(properties, "astraviaAndroidVersionCode");
	if (!versionName || /[\\\\\r\n]/.test(versionName)) throw new Error("Invalid Android versionName.");
	const versionCode = Number(code);
	if (!/^[1-9]\d*$/.test(code) || !Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000) {
		throw new Error("Invalid Android versionCode.");
	}
	return { versionName, versionCode };
}

export function parseAndroidReleaseConfig(properties) {
	const abi = gradleProperty(properties, "astraviaAndroidAbi");
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

export function missingAndroidSigningSecrets(env) {
	return SIGNING_VARIABLES.filter((name) => !env[name]);
}

// 未配置签名凭据时不发布 APK：未签名的包无法安装，构建出来也没有意义。
export function resolveAndroidSigning(env, config = readAndroidReleaseConfig()) {
	const missing = missingAndroidSigningSecrets(env);
	if (missing.length === SIGNING_VARIABLES.length) return { available: false };
	return { available: true, environment: prepareAndroidRelease(env, config) };
}

function reportAndroidSigning(env, available) {
	if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required to report Android signing availability.");
	appendFileSync(env.GITHUB_OUTPUT, `android_signing_available=${available}\n`);
}

// 返回写入日志的一行；缺少签名凭据时只声明可用性，由工作流跳过签名链路。
export function runAndroidSigningStep(env, config = readAndroidReleaseConfig()) {
	if (!env.GITHUB_ENV) throw new Error("GITHUB_ENV is required to prepare an Android release.");
	const signing = resolveAndroidSigning(env, config);
	reportAndroidSigning(env, signing.available);
	if (!signing.available) {
		if (env.GITHUB_STEP_SUMMARY) {
			appendFileSync(
				env.GITHUB_STEP_SUMMARY,
				"### Android APK skipped\n\nNo `ASTRAVIA_ANDROID_KEYSTORE_*` signing credentials are configured, so no signed APK was built or uploaded.\n",
			);
		}
		return "::warning::No Android signing credentials configured; skipping the signed Android APK build and release upload.";
	}
	appendFileSync(
		env.GITHUB_ENV,
		`${Object.entries(signing.environment)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n")}\n`,
	);
	return "Android release signing prepared.";
}

export function prepareAndroidRelease(env, config = readAndroidReleaseConfig()) {
	const missing = missingAndroidSigningSecrets(env);
	if (missing.length > 0) throw new Error(`Missing Android signing secrets: ${missing.join(", ")}`);
	if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) || /[\r\n]/.test(env.RUNNER_TEMP)) {
		throw new Error("RUNNER_TEMP must be an absolute single-line path.");
	}
	const encoded = env.ASTRAVIA_ANDROID_KEYSTORE_BASE64.replace(/\s/g, "");
	const keystore = Buffer.from(encoded, "base64");
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || keystore.toString("base64") !== encoded) {
		throw new Error("ASTRAVIA_ANDROID_KEYSTORE_BASE64 is not valid base64.");
	}
	const signingDirectory = mkdtempSync(join(env.RUNNER_TEMP, "android-signing-"));
	const keystorePath = join(signingDirectory, "release.jks");
	writeFileSync(keystorePath, keystore, { mode: 0o600 });
	return {
		ASTRAVIA_ANDROID_KEYSTORE_PATH: keystorePath,
		ASTRAVIA_ANDROID_APK_PATH: join(env.RUNNER_TEMP, "android-release", `Astravia-${config.abi}.apk`),
	};
}

export function stageAndroidApk(directory, env, config = readAndroidReleaseConfig()) {
	const { versionName, versionCode, abi } = config;
	const metadata = JSON.parse(readFileSync(join(directory, "output-metadata.json"), "utf8"));
	const element = metadata?.elements?.[0];
	if (
		!metadata ||
		metadata.applicationId !== "org.astravia.android" ||
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
	const destination = join(env.RUNNER_TEMP, "android-release", `Astravia-${abi}.apk`);
	if (env.ASTRAVIA_ANDROID_APK_PATH !== destination) throw new Error("Unexpected Android release APK destination.");
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
			console.log(runAndroidSigningStep(process.env));
		} else {
			throw new Error("Usage: prepare-android-release.mjs [--stage-apk <directory>]");
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
