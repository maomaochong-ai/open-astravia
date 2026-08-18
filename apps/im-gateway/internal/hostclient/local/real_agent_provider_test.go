package local

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type realAgentProvider struct {
	*httptest.Server
	workspaceFile string
	mu            sync.Mutex
	requests      int
}

func newRealAgentProvider(workspaceFile string) *realAgentProvider {
	provider := &realAgentProvider{workspaceFile: workspaceFile}
	provider.Server = httptest.NewServer(http.HandlerFunc(provider.serveHTTP))
	return provider
}

func (p *realAgentProvider) RequestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests
}

func (p *realAgentProvider) serveHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || request.URL.Path != "/responses" {
		http.NotFound(response, request)
		return
	}
	var body map[string]any
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		http.Error(response, err.Error(), http.StatusBadRequest)
		return
	}
	p.mu.Lock()
	requestIndex := p.requests
	p.requests++
	p.mu.Unlock()

	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	if requestIndex == 0 {
		if !providerExposesTool(body, "read") {
			http.Error(response, "read tool is missing from the IM Provider request", http.StatusBadRequest)
			return
		}
		writeProviderEvents(response, toolCallEvents("read", map[string]any{"path": p.workspaceFile}))
		return
	}
	if requestIndex == 1 && !strings.Contains(mustJSON(body), realAgentFileContent) {
		http.Error(response, "read tool result is missing from the follow-up Provider request", http.StatusBadRequest)
		return
	}
	writeProviderEvents(response, textResponseEvents(realAgentReply))
}

func writeRealAgentConfiguration(t *testing.T, agentDir, baseURL string) {
	t.Helper()
	models := map[string]any{
		"providers": map[string]any{
			"test": map[string]any{
				"baseUrl": baseURL,
				"api":     "openai-responses",
				"models": []map[string]any{{
					"id":            "test-model",
					"name":          "Test Model",
					"reasoning":     true,
					"input":         []string{"text"},
					"cost":          map[string]int{"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
					"contextWindow": 8000,
					"maxTokens":     1000,
				}},
			},
		},
	}
	writeJSONFile(t, filepath.Join(agentDir, "models.json"), models)
	writeJSONFile(t, filepath.Join(agentDir, "auth.json"), map[string]any{
		"test": map[string]string{"type": "api_key", "key": "test-key"},
	})
}

func writeJSONFile(t *testing.T, path string, value any) {
	t.Helper()
	content, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal %s: %v", path, err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func providerExposesTool(body map[string]any, name string) bool {
	tools, ok := body["tools"].([]any)
	if !ok {
		return false
	}
	for _, value := range tools {
		tool, ok := value.(map[string]any)
		if ok && tool["name"] == name {
			return true
		}
	}
	return false
}

func toolCallEvents(name string, arguments map[string]any) []any {
	argumentsJSON := mustJSON(arguments)
	item := map[string]any{
		"type":      "function_call",
		"id":        "fc_im_real",
		"call_id":   "call_im_real",
		"name":      name,
		"arguments": argumentsJSON,
		"status":    "completed",
	}
	return []any{
		map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type": "function_call", "id": "fc_im_real", "call_id": "call_im_real",
				"name": name, "arguments": "", "status": "in_progress",
			},
		},
		map[string]any{
			"type": "response.function_call_arguments.delta", "item_id": "fc_im_real",
			"output_index": 0, "delta": argumentsJSON,
		},
		map[string]any{
			"type": "response.function_call_arguments.done", "item_id": "fc_im_real",
			"output_index": 0, "arguments": argumentsJSON,
		},
		map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item},
		completedResponse("resp_im_real_tool"),
	}
}

func textResponseEvents(text string) []any {
	item := map[string]any{
		"type": "message", "id": "msg_im_real", "status": "completed", "role": "assistant",
		"content": []map[string]any{{"type": "output_text", "text": text, "annotations": []any{}}},
	}
	return []any{
		map[string]any{
			"type": "response.output_item.added", "output_index": 0,
			"item": map[string]any{"type": "message", "id": "msg_im_real", "status": "in_progress", "role": "assistant", "content": []any{}},
		},
		map[string]any{
			"type": "response.content_part.added", "item_id": "msg_im_real", "output_index": 0, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
		},
		map[string]any{
			"type": "response.output_text.delta", "item_id": "msg_im_real", "output_index": 0,
			"content_index": 0, "delta": text,
		},
		map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item},
		completedResponse("resp_im_real_text"),
	}
}

func completedResponse(id string) map[string]any {
	return map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": id, "object": "response", "status": "completed", "output": []any{},
			"usage": map[string]any{
				"input_tokens": 10, "input_tokens_details": map[string]int{"cached_tokens": 0},
				"output_tokens": 5, "output_tokens_details": map[string]int{"reasoning_tokens": 0}, "total_tokens": 15,
			},
		},
	}
}

func writeProviderEvents(response http.ResponseWriter, events []any) {
	for _, event := range events {
		_, _ = fmt.Fprintf(response, "data: %s\n\n", mustJSON(event))
	}
	_, _ = fmt.Fprint(response, "data: [DONE]\n\n")
}

func mustJSON(value any) string {
	content, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(content)
}
