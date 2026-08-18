import speechModelManifest from "./model-manifest.json";

export type SpeechModelFileName = "encoder.int8.onnx" | "decoder.onnx" | "joiner.int8.onnx" | "tokens.txt";

export interface SpeechModelFile {
	name: SpeechModelFileName;
	size: number;
	sha256: string;
	url: string;
}

export interface SpeechModelDefinition {
	id: string;
	sampleRate: number;
	totalBytes: number;
	files: readonly SpeechModelFile[];
}

const MODEL_FILE_NAMES = new Set<SpeechModelFileName>([
	"encoder.int8.onnx",
	"decoder.onnx",
	"joiner.int8.onnx",
	"tokens.txt",
]);

function parseModelFileName(value: string): SpeechModelFileName {
	if (!MODEL_FILE_NAMES.has(value as SpeechModelFileName)) throw new Error(`Unsupported speech model file: ${value}`);
	return value as SpeechModelFileName;
}

const files = speechModelManifest.files.map((file) => ({ ...file, name: parseModelFileName(file.name) }));

export const WINDOWS_ZIPFORMER_MODEL: SpeechModelDefinition = {
	id: speechModelManifest.id,
	sampleRate: speechModelManifest.sampleRate,
	totalBytes: files.reduce((total, file) => total + file.size, 0),
	files,
};

export interface SpeechModelPaths {
	encoder: string;
	decoder: string;
	joiner: string;
	tokens: string;
}

export function resolveSpeechModelPaths(modelDirectory: string): SpeechModelPaths {
	return {
		encoder: `${modelDirectory}/encoder.int8.onnx`,
		decoder: `${modelDirectory}/decoder.onnx`,
		joiner: `${modelDirectory}/joiner.int8.onnx`,
		tokens: `${modelDirectory}/tokens.txt`,
	};
}
