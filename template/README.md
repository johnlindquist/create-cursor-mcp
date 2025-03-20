# WebSockets MCP Math Demo

A reference implementation demonstrating the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) using Cloudflare Workers and Durable Objects.

We create an MCP server in a Durable object using `DurableMCP` and expose a web frontend that can connect
call those endpoints.


## Overview

This repository provides a reference implementation of MCP over WebSockets. It showcases:

- Complete MCP client-server architecture
- Tool discovery and invocation
- Deployment using Cloudflare Workers

## Development

Install dependencies:

```bash
pnpm install
```

Start the development server with:

```bash
pnpm run dev
```

Your application will be available at [http://localhost:5173](http://localhost:5173).

## Deployment

```bash
npx deploy
```

## Using with Cursor

After deployment, you can generate the MCP configuration JSON to add to your Cursor AI settings:

```bash
pnpm run print-mcp-json
```

This will output a JSON configuration like this:

```json
{
  "mcpServers": {
    "your-project-name": {
      "command": "/path/to/workers-mcp",
      "args": ["run", "your-project-name", "https://your-project-name.workers.dev", "/path/to/project"]
    }
  }
}
```

You can add this to your Cursor settings to enable your MCP tools.

If you deployed to a custom URL, you can specify it:

```bash
pnpm run print-mcp-json https://your-custom-worker-url.com
```
