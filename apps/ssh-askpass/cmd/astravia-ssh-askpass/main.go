// Command astravia-ssh-askpass is the Windows askpass helper for OpenSSH.
//
// OpenSSH launches the program named by SSH_ASKPASS with the prompt as its first
// argument and expects the answer on stdout (exit 0 = answered). This build is a
// real PE executable — Windows OpenSSH starts SSH_ASKPASS with CreateProcessW, so
// the `.sh` wrapper used on macOS/Linux cannot run here (error 193,
// ERROR_BAD_EXE_FORMAT). It connects back to the desktop main process over the
// loopback address carried in ASTRAVIA_ASKPASS_SOCKET and relays the prompt, then
// prints the user's answer.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"time"
)

const requestTimeout = 5 * time.Second

type request struct {
	Token     string `json:"token"`
	HostID    string `json:"hostId"`
	Prompt    string `json:"prompt"`
	PromptEnv string `json:"promptEnv"`
	Round     int    `json:"round"`
}

type reply struct {
	OK    bool   `json:"ok"`
	Value string `json:"value"`
}

func main() {
	address := os.Getenv("ASTRAVIA_ASKPASS_SOCKET")
	token := os.Getenv("ASTRAVIA_ASKPASS_TOKEN")
	hostID := os.Getenv("ASTRAVIA_ASKPASS_HOST")
	promptEnv := os.Getenv("SSH_ASKPASS_PROMPT")
	prompt := ""
	if len(os.Args) > 1 {
		prompt = os.Args[1]
	}

	// Without a channel we must fail: silently succeeding would turn confirmation
	// prompts (host key fingerprints) into "always yes".
	if address == "" || token == "" {
		fmt.Fprintln(os.Stderr, "astravia askpass: missing channel")
		os.Exit(1)
	}

	conn, err := net.DialTimeout("tcp", address, requestTimeout)
	if err != nil {
		os.Exit(1)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(requestTimeout))

	// The parent process is the ssh that exec'd us; it identifies the auth round so
	// the desktop app can tell a second prompt in one attempt from a new connection.
	req := request{
		Token:     token,
		HostID:    hostID,
		Prompt:    prompt,
		PromptEnv: promptEnv,
		Round:     os.Getppid(),
	}
	body, _ := json.Marshal(req)
	if _, err := conn.Write(append(body, '\n')); err != nil {
		os.Exit(1)
	}

	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil || len(line) == 0 {
		os.Exit(1)
	}
	var answer reply
	if err := json.Unmarshal(line, &answer); err != nil {
		os.Exit(1)
	}
	if !answer.OK {
		os.Exit(1)
	}
	if answer.Value != "" {
		fmt.Println(answer.Value)
	} else {
		// 确认类提示（首次主机指纹核对）读 stdout 的 "yes"，不是只看退出码；
		// 空 value 只出现在 confirm 场景，补 "yes"。
		fmt.Println("yes")
	}
}
