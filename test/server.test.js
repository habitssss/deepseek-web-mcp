import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';

async function connect(t, fetchImpl, options = {}) {
  const server = createServer({ apiKey: 'test-only-key', fetchImpl, ...options });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test('search forwards all options to the Search API and preserves results', async (t) => {
  const expected = {
    results: [{
      title: 'DeepSeek 文档', url: 'https://api-docs.deepseek.com/guides/search',
      rerank_score: 2.4, snippet: 'Short excerpt', summary: 'Longer summary',
      content: '# 正文\n\nSearch and fetch.', site_name: 'DeepSeek', site_icon: null,
      date: null, authority: 3, extra_field: 'preserved',
    }],
    extra_metadata: 'also preserved',
  };
  const args = {
    query: 'DeepSeek site:github.com lang:zh', count: 3, need_content: true,
    ori_question: '哪里有文档？', localization: '203.0.113.7',
  };
  let request;
  const client = await connect(t, async (url, options) => {
    request = { url, options };
    return Response.json(expected);
  });
  const result = await client.callTool({ name: 'search', arguments: args });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(request.url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), args);
});

test('search applies defaults, accepts 128 Unicode characters and empty results', async (t) => {
  let body;
  const client = await connect(t, async (_, options) => {
    body = JSON.parse(options.body);
    return Response.json({ results: [] });
  });
  const query = '🔍'.repeat(128);
  const result = await client.callTool({ name: 'search', arguments: { query, ori_question: null } });
  assert.deepEqual(body, { query, ori_question: null, count: 10, need_content: false });
  assert.deepEqual(result.structuredContent, { results: [] });
});

test('fetch sends the URL to DeepSeek, not to the target site, and returns Markdown', async (t) => {
  const expected = { title: '', content: '# Hello\n\n[Source](https://example.com)' };
  let request;
  const client = await connect(t, async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return Response.json(expected);
  });
  const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com/a?b=1' } });
  assert.deepEqual(request, {
    url: 'https://api.deepseek.com/v1/tools/fetch', body: { url: 'https://example.com/a?b=1' },
  });
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
});

test('invalid arguments fail before an upstream request', async (t) => {
  let calls = 0;
  const client = await connect(t, async () => { calls++; return Response.json({ results: [] }); });
  for (const args of [
    { query: '' }, { query: ' \n ' }, { query: '🔍'.repeat(129) },
    { query: 'test', count: 0 }, { query: 'test', count: 51 },
    { query: 'test', count: 1.5 }, { query: 'test', need_content: 'false' },
    { query: 'test', ori_question: 'x'.repeat(129) },
  ]) {
    assert.equal((await client.callTool({ name: 'search', arguments: args })).isError, true);
  }
  for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'not a url', 'https://example.com/' + 'x'.repeat(8192)]) {
    assert.equal((await client.callTool({ name: 'fetch', arguments: { url } })).isError, true);
  }
  assert.equal(calls, 0);
});

test('HTTP and transport errors do not leak upstream bodies', async (t) => {
  let status = 401;
  let calls = 0;
  const client = await connect(t, async () => {
    calls++;
    if (status === 0) throw new Error('secret-in-network-error');
    return new Response('secret-in-upstream-body', { status });
  }, { retryDelayMs: 0 });
  for (status of [401, 402, 404, 429, 500]) {
    const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(JSON.stringify(result), /secret-in-/);
  }
  status = 0;
  const result = await client.callTool({ name: 'search', arguments: { query: 'test' } });
  assert.equal(result.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /secret-in-/);
  // 401, 402 and 404 fail once; 429 and 500 are retried twice; a transport error is not retried.
  assert.equal(calls, 10);
});

test('retryable failures are retried and the successful response is returned', async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
    if (calls === 2) return new Response('', { status: 503 });
    return Response.json({ results: [] });
  }, { retryDelayMs: 0 });
  const result = await client.callTool({ name: 'search', arguments: { query: 'retry' } });
  assert.equal(calls, 3);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { results: [] });
});

test('retries stop after two attempts and report the last status', async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls++;
    return new Response('', { status: 500 });
  }, { retryDelayMs: 0 });
  const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
  assert.equal(calls, 3);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 500/);
});

test('non-retryable failures are not retried', async (t) => {
  for (const status of [400, 401, 402, 403, 404]) {
    let calls = 0;
    const client = await connect(t, async () => {
      calls++;
      return new Response('', { status });
    }, { retryDelayMs: 0 });
    const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
    assert.equal(calls, 1);
    assert.equal(result.isError, true);
  }
});

test('identical successful calls reuse the cached response', async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls++;
    return Response.json({ results: [] });
  }, { cacheTtlMs: 60_000 });
  await client.callTool({ name: 'search', arguments: { query: 'cached' } });
  await client.callTool({ name: 'search', arguments: { query: 'cached' } });
  await client.callTool({ name: 'search', arguments: { query: 'different' } });
  assert.equal(calls, 2);
});

test('the cache can be disabled and never stores failures', async (t) => {
  let successes = 0;
  const disabled = await connect(t, async () => {
    successes++;
    return Response.json({ results: [] });
  }, { cacheTtlMs: 0 });
  await disabled.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
  await disabled.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
  assert.equal(successes, 2);

  let failures = 0;
  const retrying = await connect(t, async () => {
    failures++;
    return new Response('', { status: 404 });
  }, { retryDelayMs: 0, cacheTtlMs: 60_000 });
  await retrying.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
  await retrying.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
  assert.equal(failures, 2);
});

test('malformed upstream responses are tool errors, not successful content', async (t) => {
  let response = 'not json';
  const client = await connect(t, async () => new Response(response));
  for (response of ['not json', '{}', '{"results":"wrong"}']) {
    const result = await client.callTool({ name: 'search', arguments: { query: 'test' } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'DeepSeek returned an invalid response.');
  }
});

test('CLI negotiates MCP over stdio and lists both tools', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['cli.js'],
    env: { DEEPSEEK_API_KEY: 'test-only-key' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr.on('data', (data) => { stderr += data; });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['fetch', 'search']);
  assert.ok(tools.every((tool) => tool.outputSchema && tool.annotations.readOnlyHint));
  assert.equal(stderr, '');
});

test('CLI without a key exits nonzero and writes no stdout', () => {
  const result = spawnSync(process.execPath, ['cli.js'], {
    env: { ...process.env, DEEPSEEK_API_KEY: '' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /DEEPSEEK_API_KEY/);
});
