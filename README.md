# create-mcp

> Forked from https://github.com/zueai/create-mcp

A CLI tool that sets up a [Model Control Protocol (MCP)](https://modelcontextprotocol.io) server and deploys it to Cloudflare Workers so you can start making new tools for your Cursor Agent in minutes.

> Just write TypeScript functions with JSDoc comments to give your agent MCP tools.

## Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and logged in with your Cloudflare account.

## Instructions

To scaffold and deploy a new MCP server, just run:

```bash
npx create-cursor-mcp
```

You can also pass a name directly to the command: `npx create-cursor-mcp --name <server-name>`.

## Features

- **Automatic Semantic Versioning**: Versions are automatically determined by commit messages following the [Conventional Commits](https://www.conventionalcommits.org/) format.
- **GitHub Actions CI/CD**: Automatic testing, version bumping, and npm publishing when changes are pushed to the main branch.
- **TypeScript**: First-class TypeScript support for MCP functions.
- **Cloudflare Workers Integration**: Deploy directly to Cloudflare Workers for globally distributed MCP tools.

## What this CLI does

- Clones the template worker repository into `<current-dir>/<server-name>`
- Installs dependencies
- Initializes a Git repository
- Deploys a Hello World MCP server to your Cloudflare account
- Prints MCP server command as JSON output

## How to Use

Just add functions to the `MyWorker` class in `src/index.ts`. Each function will compile into an MCP tool.

For example:

```typescript
/**
 * A warm, friendly greeting from your new Workers MCP server.
 * @param name {string} the name of the person we are greeting.
 * @return {string} the contents of our greeting.
 */
sayHello(name: string) {
    return `Hello from an MCP Worker, ${name}!`;
}
```

- The first line is the tool's description.
- The `@param` tags are the tool's params, with types and descriptions.
- The `@return` tag is the tool's return value, with its type.

## Deploying Changes

1. Redeploy the worker:

```bash
npm run deploy
```

2. Reload your Cursor window.

Now you can ask your agent to use the new tool!

## Why Cloudflare Workers?

Vibes, great DX, and blazing fast deployments.

I don't like running MCP servers locally, and I'm pretty sure you don't either. Now we don't have to run node processes to use simple MCP tools in Cursor that call APIs.

All you have to do is write functions. Put your descriptions and params in JSDoc comments and it just works.

## Example Servers made with create-mcp

- [Neon](https://github.com/zueai/neon-mcp)
- [Cloudflare](https://github.com/zueai/cloudflare-api-mcp)
- [Vercel](https://github.com/zueai/vercel-api-mcp)
- [WorkOS](https://github.com/zueai/workos-mcp)

You can clone and deploy any MCP server made with create-mcp to your own Cloudflare account:

```bash
npx create-cursor-mcp --clone <github-url>
```

## Contributing

Contributions and feedback are extremely welcome! Please feel free to submit a Pull Request or open an issue!

### Development Workflow

This project uses semantic versioning and automated releases:

1. Fork and clone the repository
2. Install dependencies with `pnpm install`
3. Make your changes
4. Commit your changes following the [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat: add new feature` (triggers a minor version bump)
   - `fix: resolve bug issue` (triggers a patch version bump)
   - `docs: update documentation` (no version bump)
   - `chore: update dependencies` (no version bump)
   - `BREAKING CHANGE: completely change API` (triggers a major version bump)
5. Create a pull request to the `main` branch

When your PR is merged to the main branch, it will automatically:
1. Run code checks
2. Determine the next version based on commit messages
3. Create a release on GitHub with release notes
4. Publish to npm

### Documentation Generation

The template includes two approaches for generating documentation from your code:

1. **Standard docgen**: Uses the default `workers-mcp` tool to generate documentation from JSDoc comments:
   ```bash
   pnpm docgen
   ```

2. **AST-based docgen**: A more robust alternative that parses the code's Abstract Syntax Tree:
   ```bash
   pnpm docgen-acorn
   ```

The AST-based approach offers better compatibility with complex TypeScript code and provides more reliable extraction of tool definitions. It will automatically fallback to regex-based extraction if the AST parsing fails.

> **Note:** This package uses fully automated semantic versioning. Version numbers are determined by commit messages.

## Acknowledgements

This project would not be possible without [workers-mcp](https://github.com/cloudflare/workers-mcp) made by [@geelen](https://github.com/geelen)
