#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  const server = createServer({ apiKey: process.env.DEEPSEEK_API_KEY });
  await server.connect(new StdioServerTransport());
} catch {
  console.error('Could not start MCP server. Check DEEPSEEK_API_KEY and the stdio connection.');
  process.exitCode = 1;
}
