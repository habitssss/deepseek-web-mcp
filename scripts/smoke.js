import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('Set DEEPSEEK_API_KEY before running the live test. This test makes two billable API requests.');
  process.exit(1);
}

const client = new Client({ name: 'live-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../cli.js', import.meta.url))],
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['fetch', 'search']);
  const start = performance.now();
  const search = await client.callTool({
    name: 'search',
    arguments: { query: 'DeepSeek Search Fetch API site:api-docs.deepseek.com', count: 3, need_content: true },
  }, undefined, { timeout: 40_000 });
  assert.ok(!search.isError, search.content[0]?.text);
  const results = search.structuredContent.results;
  assert.ok(results.length > 0 && results.length <= 3);
  assert.ok(results.some((result) => new URL(result.url).hostname === 'api-docs.deepseek.com'));
  assert.ok(results.some((result) => result.content.length > 0));
  assert.deepEqual(JSON.parse(search.content[0].text), search.structuredContent);
  console.log(`PASS search: ${results.length} results, page content included, ${Math.round(performance.now() - start)} ms`);

  const fetchStart = performance.now();
  const fetched = await client.callTool({
    name: 'fetch', arguments: { url: 'https://api-docs.deepseek.com/guides/search' },
  }, undefined, { timeout: 40_000 });
  assert.ok(!fetched.isError, fetched.content[0]?.text);
  // The API may escape slashes in Markdown. Normalize only for these content checks.
  const page = fetched.structuredContent.content.replace(/\\\//g, '/');
  assert.ok(page.includes('/v1/tools/search'), 'Fetched page must document the Search endpoint.');
  assert.ok(page.includes('/v1/tools/fetch'), 'Fetched page must document the Fetch endpoint.');
  assert.deepEqual(JSON.parse(fetched.content[0].text), fetched.structuredContent);
  console.log(`PASS fetch: official documentation, ${fetched.structuredContent.content.length} characters, ${Math.round(performance.now() - fetchStart)} ms`);
} finally {
  await client.close();
}
