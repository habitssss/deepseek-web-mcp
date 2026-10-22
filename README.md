# DeepSeek Web MCP

<p align="center">
  <img src="assets/logo.png" alt="DeepSeek Web MCP whale and search logo" width="160" height="160">
</p>

English | [中文](README.zh-CN.md)

An MCP server that calls DeepSeek's official Search and Fetch APIs directly. It returns search results and page content without calling a chat model to generate an answer.

This is a community project, not an official DeepSeek product. It is licensed under MIT.

## Installation

You need Node.js 22 or newer and a [DeepSeek API key](https://platform.deepseek.com/api_keys).

Add the server to an MCP client that supports stdio. The client downloads and runs the npm package with `npx`; no separate installation is needed. Set `DEEPSEEK_API_KEY` through your client's secret manager if available. Otherwise, keep the key in a private local configuration file and never commit it to Git.

```json
{
  "mcpServers": {
    "deepseek-web": {
      "command": "npx",
      "args": ["-y", "deepseek-web-mcp@0.1.0"],
      "env": {
        "DEEPSEEK_API_KEY": "YOUR_DEEPSEEK_API_KEY"
      }
    }
  }
}
```

The MCP client starts the server as a child process. The server does not open a web page or listen on an HTTP port. If started directly in a terminal, it waits for MCP messages without displaying a prompt.

## Tools

| Tool | Official endpoint | Result |
| --- | --- | --- |
| `search` | `POST https://api.deepseek.com/v1/tools/search` | Ranked search results with URLs, summaries, and optional page content |
| `fetch` | `POST https://api.deepseek.com/v1/tools/fetch` | Page title and Markdown content |

### search

```json
{
  "query": "DeepSeek site:api-docs.deepseek.com",
  "count": 3,
  "need_content": true
}
```

`query` is required. It must contain 1 to 128 Unicode characters and cannot be all whitespace. DeepSeek's search operators are passed through, including `site:`, `-site:`, quoted phrases, `lang:`, `after:`, and `before:`.

| Optional parameter | Meaning | Default |
| --- | --- | --- |
| `count` | Number of results, from 1 to 50 | `10` |
| `need_content` | Include page content when available | `false` |
| `ori_question` | Original user question, up to 128 Unicode characters; accepts `null` | Omitted |
| `localization` | IP address used to localize results | Omitted |

An empty search returns `{"results":[]}` and is not an error. Setting `need_content` to `true` does not guarantee content for every result.

### fetch

```json
{
  "url": "https://api-docs.deepseek.com/guides/search"
}
```

`url` is required and limited to 8192 characters. It must use HTTP or HTTPS and cannot contain a username or password. DeepSeek fetches the page. The local MCP process does not connect to the target site.

Both tools return MCP `structuredContent` and the same JSON as text for clients that do not use structured results. Additional fields returned by the API are preserved. Page content is passed through as received, including any Markdown escapes.

## Cost and data handling

Search queries, original questions, localization IPs, and target URLs are sent to DeepSeek. Authentication uses the `DEEPSEEK_API_KEY` environment variable. The server does not store the key or log request content. Standard output is reserved for MCP messages.

Requests time out after 30 seconds and respond to client cancellation. A timeout or cancellation does not guarantee that DeepSeek stops processing the request.

Transient failures are retried automatically: HTTP 408, 429, 500, 502, 503, and 504 are retried up to twice with exponential backoff (500 ms, then 1 s), and a numeric `Retry-After` header overrides the backoff, capped at 5 seconds. Other 4xx responses, timeouts, and transport errors are returned immediately without a retry. DeepSeek bills only successful requests, so a retried call costs nothing extra unless it eventually succeeds.

Successful responses are cached in memory for 10 minutes, so repeating an identical search or fetch inside one session sends no second request. Set `DEEPSEEK_WEB_MCP_CACHE_TTL_MS` to change the window in milliseconds, or to `0` to disable caching. The cache is per server process and never stores failures; responses larger than 512 KB are not cached.

DeepSeek lists both Search and Fetch at USD 0.75 per 1,000 successful requests that produce results. Check the [official guide](https://api-docs.deepseek.com/guides/search) for current prices and limits. Free usage arrangements for products such as DeepSeek Harness do not imply that this server's direct API requests are free.

HTTP failures are returned as MCP tool errors with a status code. Upstream error bodies and exception details are not forwarded, to avoid exposing credentials. Treat web content as untrusted data, not instructions.

## Testing

Run the local tests without an API key or network calls to DeepSeek:

```sh
npm test
```

To test against the real APIs, first set `DEEPSEEK_API_KEY` in your environment, then run:

```sh
npm run test:live
```

The live test starts the CLI, completes the MCP stdio handshake, and calls both tools. It verifies search results and the fetched official documentation. It makes two billable API requests and prints counts, content length, and elapsed time without printing the key.

## Development

To run from source:

```sh
git clone https://github.com/habitssss/deepseek-web-mcp.git
cd deepseek-web-mcp
npm ci
```

For a source checkout, use `"command": "node"` and `"args": ["/absolute/path/deepseek-web-mcp/cli.js"]` in your MCP configuration instead of `npx`.

The code uses JavaScript ES modules and needs no build step. `server.js` defines the tools and API requests. `cli.js` starts the stdio transport. Run `npm test` after changes, and run the live test when changing API arguments or response handling.
