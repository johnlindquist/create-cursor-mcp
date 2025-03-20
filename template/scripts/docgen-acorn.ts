// docgen-acorn.ts
import fs from "node:fs"
import path from "node:path"
import { parse } from "acorn"
import * as walk from "acorn-walk"
import type { EntrypointDoc, MethodDoc, Param, Returns } from "./docgen-types"

// Define a more complete type for AST nodes
interface ASTNode {
	type: string
	callee?: {
		type: string
		object?: {
			type: string
			name?: string
		}
		property?: {
			name?: string
			type?: string
		}
	}
	start?: number
	end?: number
	name?: string
	value?: unknown
	properties?: Array<{
		type: string
		key: { name: string; type: string }
		value: unknown
	}>
}

interface Property {
	type: string
	key: { name: string; type: string }
	value: {
		type: string
		object?: Record<string, unknown>
		property?: Record<string, unknown>
		callee?: Record<string, unknown>
	}
	optional?: boolean
}

/**
 * Generate docs by first extracting tool sections with regex, then
 * using AST parsing on each schema object.
 */
async function generateDocs(inputFilePath?: string): Promise<void> {
	const filePath =
		inputFilePath ?? path.join(process.cwd(), "src", "api", "index.ts")

	console.log(`Reading file: ${filePath}`)
	// Read the file content
	const code = fs.readFileSync(filePath, "utf8")
	console.log(`File content length: ${code.length} characters`)
	console.log(
		`Original code sample (first 200 chars):\n${code.substring(0, 200)}...`
	)

	// First extract all tool segments from the code
	const toolSegments = extractToolSegments(code)
	console.log(`Found ${toolSegments.length} tool segments in code`)

	// Process each segment to get tool information
	const tools: MethodDoc[] = []

	for (const segment of toolSegments) {
		const tool = extractToolInfo(segment)
		if (tool) {
			tools.push(tool)
		}
	}

	// Output docs
	if (tools.length > 0) {
		console.log(
			`Successfully processed ${tools.length} tools using AST approach`
		)

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
		console.log(`Wrote docs.json with ${tools.length} tools to ${docsPath}`)

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
	} else {
		console.error("No tools found in the source code.")
	}
}

/**
 * Extract all tool declaration segments from the code
 */
function extractToolSegments(code: string): string[] {
	const segments: string[] = []

	// Find all tool declarations with their surrounding context
	const toolRegex =
		/this\.server\.tool\(\s*["']([^"']+)["'],\s*({[\s\S]+?}),\s*async/g
	let match: RegExpExecArray | null

	match = toolRegex.exec(code)
	while (match !== null) {
		// Store the full match which includes the tool name and schema
		const fullMatchStart = match.index
		const matchLen = match[0].length
		const segment = code.substring(
			fullMatchStart,
			fullMatchStart + matchLen
		)
		segments.push(segment)

		match = toolRegex.exec(code)
	}

	return segments
}

/**
 * Extract tool information from a single tool segment using AST parsing for the schema
 */
function extractToolInfo(segment: string): MethodDoc | null {
	// Extract tool name
	const nameMatch = segment.match(/this\.server\.tool\(\s*["']([^"']+)["']/)
	const toolName = nameMatch ? nameMatch[1] : "unknown"

	console.log(`Extracting info for tool: ${toolName}`)

	// Extract schema section
	const schemaMatch = segment.match(/,\s*({[\s\S]+?}),\s*async/)
	let params: Param[] = []

	if (schemaMatch) {
		const schemaText = schemaMatch[1]
		console.log(`Found schema text for ${toolName}:`)
		console.log(schemaText)

		// Create a valid JavaScript object expression for the schema
		// We'll prepend 'const schema = ' to make it parseable
		const parseableSchema = `const schema = ${schemaText}`

		try {
			// Parse the schema as a small AST
			const schemaAst = parse(parseableSchema, {
				ecmaVersion: 2022,
				sourceType: "module"
			})

			// Walk the AST to find the object properties
			params = extractSchemaParams(schemaAst)
		} catch (error) {
			console.error(`Error parsing schema for tool ${toolName}:`, error)
			// Fall back to regex-based extraction
			params = extractParamsWithRegex(schemaText)
		}
	}

	// Create the tool documentation
	return {
		name: toolName,
		description: `Auto-generated docs for "${toolName}"`,
		params,
		returns: {
			type: "string",
			description: `Result from tool "${toolName}"`
		}
	}
}

/**
 * Extract parameters from a schema AST
 */
function extractSchemaParams(schemaAst: Record<string, unknown>): Param[] {
	const params: Param[] = []

	try {
		// Walk the AST to find VariableDeclaration nodes
		walk.simple(schemaAst, {
			VariableDeclaration(node: Record<string, unknown>) {
				// We look for the schema object properties
				if (
					node.declarations &&
					Array.isArray(node.declarations) &&
					node.declarations.length > 0
				) {
					const declaration = node.declarations[0]
					if (
						declaration.init &&
						declaration.init.type === "ObjectExpression"
					) {
						const properties = declaration.init.properties

						// Process each property in the schema object
						for (const prop of properties) {
							if (
								prop.type !== "Property" ||
								prop.key.type !== "Identifier"
							) {
								continue
							}

							const paramName = prop.key.name
							let paramType = "unknown"
							let optional = false

							// Check if this is a z.type() or z.type().optional() call
							if (prop.value.type === "CallExpression") {
								const callee = prop.value.callee

								// Handle z.type()
								if (
									callee.type === "MemberExpression" &&
									callee.object.type === "Identifier" &&
									callee.object.name === "z" &&
									callee.property.type === "Identifier"
								) {
									paramType = callee.property.name
								}

								// Handle z.type().optional()
								if (
									callee.type === "MemberExpression" &&
									callee.property.type === "Identifier" &&
									callee.property.name === "optional"
								) {
									optional = true

									// Get the actual type from the inner z.type() call
									if (
										callee.object.type ===
											"CallExpression" &&
										callee.object.callee.type ===
											"MemberExpression" &&
										callee.object.callee.object.type ===
											"Identifier" &&
										callee.object.callee.object.name ===
											"z" &&
										callee.object.callee.property.type ===
											"Identifier"
									) {
										paramType =
											callee.object.callee.property.name
									}
								}
							}

							console.log(
								`Found parameter via AST: ${paramName}: ${paramType}${optional ? " (optional)" : ""}`
							)
							params.push({
								name: paramName,
								type: paramType,
								optional
							})
						}
					}
				}
			}
		})
	} catch (error) {
		console.error("Error walking schema AST:", error)
	}

	return params
}

/**
 * Fallback method to extract parameters using regex
 */
function extractParamsWithRegex(schemaText: string): Param[] {
	console.log(`[Fallback] Parsing schema text with regex: ${schemaText}`)
	// Improved regex that can handle optional parameters and different Zod types
	const regex = /(\w+)\s*:\s*z\.(\w+)\(\)(?:\.optional\(\))?/g
	const params: Param[] = []
	let match: RegExpExecArray | null

	match = regex.exec(schemaText)
	while (match !== null) {
		const optional = match[0].includes(".optional()")
		console.log(
			`Found param with regex: ${match[1]} of type ${match[2]}${optional ? " (optional)" : ""}`
		)
		params.push({
			name: match[1],
			type: match[2],
			optional
		})
		match = regex.exec(schemaText)
	}

	console.log(`[Fallback] Found ${params.length} params`)
	return params
}

/**
 * Adds WorkerEntrypoint to docs.json with exported_as: "default"
 */
function addWorkerEntrypoint() {
	try {
		const docsPath = path.join(process.cwd(), "dist", "docs.json")
		if (fs.existsSync(docsPath)) {
			const docsJson = JSON.parse(fs.readFileSync(docsPath, "utf8"))

			if (docsJson.MCPMathServer && !docsJson.WorkerEntrypoint) {
				docsJson.WorkerEntrypoint = {
					exported_as: "default",
					description:
						"Worker Entrypoint class extending MCPMathServer",
					methods: docsJson.MCPMathServer.methods,
					statics: {}
				}

				fs.writeFileSync(docsPath, JSON.stringify(docsJson, null, 2))
				console.log("Added WorkerEntrypoint to docs.json")
			}
		}
	} catch (error) {
		console.error("Error adding WorkerEntrypoint:", error)
	}
}

// Call the function directly
generateDocs(process.argv[2])
	.then(() => {
		addWorkerEntrypoint()
	})
	.catch((err) => {
		console.error("Error generating docs:", err)
		process.exit(1)
	})

export { generateDocs }
