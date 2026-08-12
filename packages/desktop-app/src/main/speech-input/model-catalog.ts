export interface SpeechModelFile {
	name: "encoder.int8.onnx" | "decoder.onnx" | "joiner.int8.onnx" | "tokens.txt";
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

const MODEL_BASE_URL =
	"https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30/resolve/main";

export const WINDOWS_ZIPFORMER_MODEL: SpeechModelDefinition = {
	id: "sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30",
	sampleRate: 16_000,
	totalBytes: 167_360_920,
	files: [
		{
			name: "encoder.int8.onnx",
			size: 161_141_793,
			sha256: "34f25f4004af5f18871515fa9304bc000e6723ab9e46c4c514e9265fa2d4d5da",
			url: `${MODEL_BASE_URL}/encoder.int8.onnx`,
		},
		{
			name: "decoder.onnx",
			size: 5_165_083,
			sha256: "53dae6fddd07cdd031cb68889f5d4c041c179bf8b7abdce4c9aed303e851cd7a",
			url: `${MODEL_BASE_URL}/decoder.onnx`,
		},
		{
			name: "joiner.int8.onnx",
			size: 1_033_416,
			sha256: "ae128b8b4e7f668954207ccbf196760967eb4eb88b089c7ed828c2d30db0dd0e",
			url: `${MODEL_BASE_URL}/joiner.int8.onnx`,
		},
		{
			name: "tokens.txt",
			size: 20_628,
			sha256: "6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652",
			url: `${MODEL_BASE_URL}/tokens.txt`,
		},
	],
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
