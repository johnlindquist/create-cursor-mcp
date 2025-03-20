// docgen-acorn.ts
import fs from "node:fs"
import path from "node:path"
import { parse } from "acorn"
import * as walk from "acorn-walk"
import type { EntrypointDoc, MethodDoc, Param, Returns } from "./docgen-types"

// Define explicit Node type to avoid 'any' usage
interface ASTNode {
	type: string
	callee?: {
		type: string
		object?: {
			type: string
			object?: {
				type: string
			}
			property?: {
				name?: string
			}
		}
		property?: {
			name?: string
		}
	}
	arguments?: unknown[]
	value?: unknown
	start?: number
	end?: number
}

/**
 * A naive parser to find something like "a: z.number(), b: z.number()" within a string.
 */
function parseZodSchema(schemaText: string): Param[] {
	const regex = /(\w+)\s*:\s*z\.(\w+)\(\)/g
	const params: Param[] = []
	let match: RegExpExecArray | null

	// Use a different approach to avoid assignment in expression
	match = regex.exec(schemaText)
	while (match !== null) {
		console.log(`Found param: ${match[1]} of type ${match[2]}`)
		params.push({
			name: match[1],
			type: match[2]
		})
		match = regex.exec(schemaText)
	}
	return params
}

async function generateDocs(inputFilePath?: string): Promise<void> {
	const filePath =
		inputFilePath ?? path.join(process.cwd(), "src", "api", "index.ts")

	console.log(`Reading file: ${filePath}`)
	// Read the file content
	const code = fs.readFileSync(filePath, "utf8")

	// Preprocess TypeScript to JavaScript for parsing
	// Remove type definitions, interfaces, etc.
	const jsCode = code
		.replace(/export\s+interface\s+\w+\s*\{[^}]*\}/g, "")
		.replace(/:\s*\w+(\[\])?/g, "")
		.replace(/<[^>]*>/g, "")
		.replace(/implements\s+\w+/g, "")
		.replace(/extends\s+\w+(<[^>]*>)?/g, "")
		.replace(/satisfies\s+\w+(<[^>]*>)?/g, "")

	try {
		// Parse the code to an AST with basic acorn
		const ast = parse(jsCode, {
			ecmaVersion: 2022,
			sourceType: "module",
			locations: true,
			allowAwaitOutsideFunction: true,
			allowImportExportEverywhere: true
		})

		// We'll store discovered tools in an array
		const tools: MethodDoc[] = []

		// Walk the AST, looking for CallExpressions
		walk.simple(ast, {
			CallExpression(node: ASTNode) {
				// Using typed interface instead of any
				// We're looking for something like `this.server.tool(...)`
				if (
					node.callee &&
					node.callee.type === "MemberExpression" &&
					node.callee.object?.type === "MemberExpression" &&
					node.callee.object.object?.type === "ThisExpression" &&
					node.callee.object.property?.name === "server" &&
					node.callee.property?.name === "tool"
				) {
					console.log("Found a tool call!")

					// Process the tool call
					const args = node.arguments
					if (!args || args.length < 3) {
						console.log("Not enough arguments, skipping")
						return
					}

					const toolNameNode = args[0] as ASTNode
					const zodSchemaNode = args[1] as ASTNode

					// Extract tool name
					let toolName = "unknownTool"
					if (
						toolNameNode.type === "Literal" &&
						typeof toolNameNode.value === "string"
					) {
						toolName = toolNameNode.value
						console.log(`Tool name: ${toolName}`)
					}

					// Parse Zod schema from the original code
					const start = zodSchemaNode.start ?? 0
					const end = zodSchemaNode.end ?? 0
					const zodSchemaText = code.substring(start, end)
					console.log(`Schema text: ${zodSchemaText}`)

					const params: Param[] = parseZodSchema(zodSchemaText)
					console.log(`Params found: ${params.length}`)

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

		// Output docs to dist/docs.json
		const docsJson: Record<string, EntrypointDoc> = {
			MCPMathServer: {
				exported_as: "MCPMathServer",
				description: "Detected tools from this.server.tool(...) calls",
				methods: tools,
				statics: {}
			}
		}

		const distDir = path.join(process.cwd(), "dist")
		fs.mkdirSync(distDir, { recursive: true })
		const docsPath = path.join(distDir, "docs.json")
		fs.writeFileSync(docsPath, JSON.stringify(docsJson, null, 2))
		console.log(
			`Wrote docs.json with ${tools.length} tools discovered to ${docsPath}`
		)

		// Print a summary of discovered tools
		console.log("\nDiscovered tools:")
		for (const tool of tools) {
			console.log(`• ${tool.name}`)
			console.log(`  - Description: ${tool.description}`)
			console.log("  - Parameters:")
			for (const param of tool.params) {
				console.log(
					`    * ${param.name}: ${param.type}${param.optional ? " (optional)" : ""}`
				)
			}
			console.log(`  - Returns: ${tool.returns?.type || "void"}`)
			console.log("")
		}
	} catch (error) {
		console.error("Error parsing JavaScript:", error)
		// Fall back to regex-based approach
		console.log("Falling back to regex-based extraction...")
		const tools = extractToolsWithRegex(code)

		// Output docs from regex approach
		const docsJson: Record<string, EntrypointDoc> = {
			MCPMathServer: {
				exported_as: "MCPMathServer",
				description:
					"Detected tools from this.server.tool(...) calls using regex fallback",
				methods: tools,
				statics: {}
			}
		}

		const distDir = path.join(process.cwd(), "dist")
		fs.mkdirSync(distDir, { recursive: true })
		const docsPath = path.join(distDir, "docs.json")
		fs.writeFileSync(docsPath, JSON.stringify(docsJson, null, 2))
		console.log(
			`Wrote docs.json with ${tools.length} tools discovered using regex fallback`
		)
	}
}

/**
 * Fallback regex-based approach for extracting tools
 */
function extractToolsWithRegex(code: string): MethodDoc[] {
	const tools: MethodDoc[] = []

	// Find all tool calls
	const toolRegex = /this\.server\.tool\(\s*["']([^"']+)["'],\s*({[^}]+}),/g
	let match: RegExpExecArray | null

	// Use a different approach to avoid assignment in expression
	match = toolRegex.exec(code)
	while (match !== null) {
		const toolName = match[1]
		const schemaText = match[2]
		console.log(`Found tool via regex: ${toolName}`)

		const params = parseZodSchema(schemaText)

		tools.push({
			name: toolName,
			description: `Auto-generated docs for "${toolName}" (regex-extracted)`,
			params,
			returns: {
				type: "string",
				description: `Result from tool "${toolName}"`
			}
		})
		match = toolRegex.exec(code)
	}

	return tools
}

// Call the function directly
generateDocs(process.argv[2]).catch((err) => {
	console.error("Error generating docs:", err)
	process.exit(1)
})

export { generateDocs }
