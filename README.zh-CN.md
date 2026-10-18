# DeepSeek Web MCP

[English](README.md) | 中文

一个直接调用 DeepSeek 官方 Search 和 Fetch API 的 MCP 服务。它返回搜索结果和网页正文，不调用聊天模型生成答案。

这是社区项目，与 DeepSeek 官方无隶属关系。代码采用 MIT 协议。

## 安装与配置

需要 Node.js 22 或更新版本，以及 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。

先下载并安装依赖：

```sh
git clone https://github.com/habitssss/deepseek-web-mcp.git
cd deepseek-web-mcp
npm ci
```

在支持 stdio MCP 的客户端配置中添加以下内容。请将路径改为实际的绝对路径，并通过客户端的密钥管理功能设置 `DEEPSEEK_API_KEY`。如果客户端不提供密钥管理，可以在私有本地配置的 `env` 中填写，不能提交到 Git。

```json
{
  "mcpServers": {
    "deepseek-web": {
      "command": "node",
      "args": ["/absolute/path/deepseek-web-mcp/cli.js"],
      "env": {
        "DEEPSEEK_API_KEY": "YOUR_DEEPSEEK_API_KEY"
      }
    }
  }
}
```

这是 stdio 服务，由 MCP 客户端启动，不会打开网页或监听 HTTP 端口。正常启动后会等待客户端发送消息，不会在终端显示提示符。

## 工具

| 工具 | 官方接口 | 返回内容 |
| --- | --- | --- |
| `search` | `POST https://api.deepseek.com/v1/tools/search` | 排序后的搜索结果，包括网址、摘要和可选正文 |
| `fetch` | `POST https://api.deepseek.com/v1/tools/fetch` | 网页标题和 Markdown 正文 |

### search

```json
{
  "query": "DeepSeek site:api-docs.deepseek.com",
  "count": 3,
  "need_content": true
}
```

`query` 必填，长度为 1 至 128 个 Unicode 字符，不能全为空白。支持官方的 `site:`、`-site:`、引号短语、`lang:`、`after:`、`before:` 等搜索语法。

可选参数包括 `count`（1 至 50，默认 10）、`need_content`（默认 `false`）、`ori_question`（原始问题，最多 128 个 Unicode 字符，也可为 `null`）和 `localization`（用于定位搜索结果的 IP 地址）。

没有搜索结果时返回 `{"results":[]}`，不视为错误。`need_content: true` 不保证每个结果都有正文，具体取决于 DeepSeek 的抓取结果。

### fetch

```json
{
  "url": "https://api-docs.deepseek.com/guides/search"
}
```

`url` 必填，最多 8192 个字符，仅接受 HTTP 或 HTTPS，不能包含用户名或密码。网页由 DeepSeek 抓取，本地 MCP 进程不会直接访问目标网址。

两个工具均返回 MCP `structuredContent`，并在文本内容中提供相同的 JSON，方便不支持结构化结果的客户端读取。结果保留 API 返回的额外字段。

## 费用与数据

搜索词、原始问题、定位 IP 和目标网址会发送给 DeepSeek。请求使用 `DEEPSEEK_API_KEY` 环境变量鉴权，服务不会保存密钥，也不会记录请求内容。stdout 只用于 MCP 协议通信。

每次工具调用只发送一次 API 请求，不自动重试。请求在 30 秒后超时，也会响应客户端取消。超时或取消不能保证 DeepSeek 停止处理请求。

Search 和 Fetch 的官方标价均为每 1000 次成功且有结果的请求 0.75 美元。价格和限制可能调整，以 [官方文档](https://api-docs.deepseek.com/guides/search) 为准。DeepSeek 在 Harness 等产品中的免费安排不代表本项目的直接 API 请求免费。

HTTP 错误以 MCP 工具错误返回。错误信息包含状态码，不回传上游错误正文或异常细节，以免泄露凭据。网页内容是不可信数据，客户端不应把其中的文字当作指令。

## 测试

本地测试不需要 API Key，也不会请求 DeepSeek：

```sh
npm test
```

实际 API 测试需要先在环境中设置 `DEEPSEEK_API_KEY`：

```sh
npm run test:live
```

实际测试会启动 CLI，通过 MCP stdio 完成握手，再分别调用 Search 和 Fetch。它检查搜索结果及官方文档正文，会产生两次 API 请求费用。测试只输出数量、长度和耗时，不输出密钥。

## 开发

代码使用 JavaScript ES modules，无需构建。`server.js` 定义工具及 API 请求，`cli.js` 提供 stdio 入口。修改后运行 `npm test`；修改 API 参数或返回值处理时，还应运行实际 API 测试。
