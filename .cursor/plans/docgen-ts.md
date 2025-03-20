Below is a minimal example illustrating how to switch from a regex-based approach to an **AST-based** approach using [acorn](https://github.com/acornjs/acorn) and [acorn-walk](https://github.com/acornjs/acorn/tree/master/acorn-walk) for parsing and walking the syntax tree. This example specifically looks for calls to `this.server.tool(...)`, extracts the relevant arguments, and outputs a JSON structure representing discovered tools.

> **Note**: This example is intentionally minimal and doesn’t handle every edge case. You may need to enhance it to handle multi-line calls, nested references, advanced TypeScript features, or doc comments. But it should illustrate the general structure you can follow.

---

## 1. Install Dependencies

```
pnpm add -D acorn acorn-walk
```

---

## 2. Example `docgen-acorn.ts` Script

Below is a single file script that:
1. Reads an example `index.ts` from disk.
2. Parses the code into an AST with `acorn`.
3. Uses `acorn-walk` to traverse the AST and detect function calls of the form `this.server.tool(...)`.
4. Extracts the tool name, Zod schema object, etc.
5. Stores them in a `tools[]` array and writes to `dist/docs.json`.

```ts
// docgen-acorn.ts
import fs from "fs"
import path from "path"
import { parse } from "acorn"
// If you prefer TypeScript syntax, you might do: import * as acorn from "acorn";
import * as walk from "acorn-walk"

interface Param {
  name: string
  type: string
  description?: string
  optional?: boolean
}

interface Returns {
  type: string
  description?: string
}

interface ToolDoc {
  name: string
  description: string
  params: Param[]
  returns: Returns | null
}

async function generateDocs() {
  const filePath = path.join(__dirname, "..", "..", "src", "api", "index.ts")
  const code = fs.readFileSync(filePath, "utf8")

  // 1) Parse the code to an AST with acorn
  const ast = parse(code, {
    ecmaVersion: "latest",
    sourceType: "module" // or 'script' if you have non-ESM code
  }) as any // acorn’s types are basic. You might prefer a type-casting or store as unknown.

  // We'll store discovered tools in an array
  const tools: ToolDoc[] = []

  // 2) Walk the AST, looking for CallExpressions
  walk.simple(ast, {
    CallExpression(node: any) {
      // We're looking for something like `this.server.tool(...)`
      // That means:
      //   node.callee = MemberExpression
      //   node.callee.object = MemberExpression => `this.server`
      //   node.callee.object.object = ThisExpression => `this`
      //   node.callee.object.property.name = 'server'
      //   node.callee.property.name = 'tool'
      if (
        node.callee &&
        node.callee.type === "MemberExpression" &&
        node.callee.object?.type === "MemberExpression" &&
        node.callee.object.object?.type === "ThisExpression" &&
        node.callee.object.property?.name === "server" &&
        node.callee.property?.name === "tool"
      ) {
        // We have a call that looks like `this.server.tool(...)`
        // Let's examine the call arguments:
        //   1) toolName (string literal)
        //   2) zod schema object
        //   3) callback function
        const args = node.arguments
        if (!args || args.length < 3) return // not enough arguments, skip

        const toolNameNode = args[0]
        const zodSchemaNode = args[1]
        const callbackNode = args[2]

        // Extract tool name if it's a string literal
        let toolName = "unknownTool"
        if (toolNameNode.type === "Literal" && typeof toolNameNode.value === "string") {
          toolName = toolNameNode.value
        }

        // Let’s do a naive parse of the Zod schema from the text (if needed).
        // Alternatively, if the schema is a literal object, we can walk that sub-tree as well.
        // For now, just store the raw text of the second argument to show how you might parse it further:
        const zodSchemaText = code.substring(zodSchemaNode.start, zodSchemaNode.end)

        // We'll also store a simple list of params found. A more advanced approach might
        // walk the schema object to detect each param’s type:
        const params: Param[] = parseZodSchema(zodSchemaText)

        // For “returns”, we might default to some known type (like 'string'), or parse further:
        const returns: Returns = {
          type: "string",
          description: `Result from tool "${toolName}"`
        }

        // Add the found tool to the array
        tools.push({
          name: toolName,
          description: `Auto-generated docs for "${toolName}"`,
          params,
          returns
        })
      }
    }
  })

  // 3) Output docs to dist/docs.json
  const docsJson = {
    MCPMathServer: {
      exported_as: "MCPMathServer",
      description: "Detected tools from this.server.tool(...) calls",
      methods: tools,
      statics: {}
    }
  }
  fs.mkdirSync("dist", { recursive: true })
  fs.writeFileSync("dist/docs.json", JSON.stringify(docsJson, null, 2))
  console.log(`Wrote docs.json with ${tools.length} tools discovered.`)
}

/**
 * A naive parser to find something like "a: z.number(), b: z.number()" within a string.
 * In reality, you'd want a more robust sub-parse or another AST walk of that argument.
 */
function parseZodSchema(schemaText: string): Param[] {
  // This is a simplistic regex approach—just to show how you might gather param names.
  const regex = /(\w+)\s*:\s*z\.(\w+)\(\)/g
  const params: Param[] = []
  let match
  while ((match = regex.exec(schemaText)) !== null) {
    params.push({
      name: match[1],
      type: match[2]
    })
  }
  return params
}

// If you want to run this script directly:
//    npx tsx ./docgen-acorn.ts
if (require.main === module) {
  generateDocs().catch((err) => {
    console.error("Error generating docs:", err)
    process.exit(1)
  })
}
```

### How It Works

1. **Parse**: We call `parse` from `acorn` with `ecmaVersion: "latest"`.  
2. **Walk**: The `walk.simple(ast, { CallExpression(node) { ... } })` function visits every `CallExpression` node.  
3. **Match**: We check if the `CallExpression` belongs to a “MemberExpression” chain that matches `this.server.tool`.  
4. **Arguments**: Once we have that call, we examine `node.arguments` to gather:
   - The tool name (assuming the first argument is a string literal).  
   - The second argument (the Zod schema), which we parse in a naive way.  
   - The third argument (callback function), which we mostly ignore for now.  
5. **Output**: We store discovered tools in an array, then generate a final JSON.  

---

## 3. Run the Script

After you’ve placed `docgen-acorn.ts` in your project (e.g., inside `./template/scripts`), run it with:

```bash
npx tsx ./template/scripts/docgen-acorn.ts
```

You should see an output like:

```
Wrote docs.json with 5 tools discovered.
```

Then, check `dist/docs.json` to confirm it has the shape you expect.

---

## 4. Verify & Iterate

- **Multiline Tool Calls**: If your calls can have multiline arguments, `acorn` can handle it just fine as it’s purely AST-based.  
- **Advanced Zod**: If you do something more advanced (e.g., `z.object({ ... })` or nested schemas), you’ll want to do a deeper AST walk of the second argument to detect each property.  
- **Optional/Complex**: If your server code uses advanced logic or conditionally calls `.tool()`, you can further refine your logic to handle that.  

---

### Conclusion

Switching to an **AST-based** approach with **acorn** (and optionally `acorn-walk`) allows you to reliably parse your code and handle more advanced scenarios. Whenever the structure of your code changes, your script can adapt by looking at different node patterns in the AST, rather than trying to maintain a complicated set of regular expressions.