# Template Scripts

This directory contains scripts used by the template MCP server.

## Documentation Generation

Two approaches for generating documentation are provided:

### 1. Standard JSDocs-based Generator (`docgen.ts`)

The standard documentation generator uses JSDocs comments to generate documentation for your MCP tools.

Usage:
```bash
pnpm docgen
```

### 2. AST-based Generator (`docgen-acorn.ts`)

The AST-based generator uses [acorn](https://github.com/acornjs/acorn) to parse JavaScript/TypeScript into an Abstract Syntax Tree and locate tool definitions programmatically. This approach is more reliable for complex TypeScript code.

Key features:
- Parses code structure using AST to locate `this.server.tool(...)` calls
- Extracts tool names, Zod schemas, and parameters
- Falls back to regex-based parsing if AST parsing fails
- Generates standard-compatible `docs.json` output

Usage:
```bash
pnpm docgen-acorn
```

## Types

The `docgen-types.ts` file contains TypeScript interfaces used by both documentation generators to ensure consistent output format.

Key types:
- `Param`: Represents a tool parameter (name, type, description)
- `Returns`: Represents a tool's return value
- `MethodDoc`: Represents a tool method with its name, description, parameters, and return type
- `EntrypointDoc`: The top-level structure for the exported documentation

## Example Output

Both generators produce a `docs.json` file in the `dist` directory that conforms to the MCP documentation standard:

```json
{
  "MCPMathServer": {
    "exported_as": "MCPMathServer",
    "description": "Detected tools from this.server.tool(...) calls",
    "methods": [
      {
        "name": "add",
        "description": "Auto-generated docs for 'add'",
        "params": [
          { "name": "a", "type": "number" },
          { "name": "b", "type": "number" }
        ],
        "returns": {
          "type": "string",
          "description": "Result from tool 'add'"
        }
      }
    ],
    "statics": {}
  }
}
``` 