#!/usr/bin/env node

import { runAgentCli } from "./run-agent-cli.js";

await runAgentCli(process.argv.slice(2));
