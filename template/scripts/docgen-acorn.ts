// docgen-acorn.ts
import fs from "node:fs"
import path from "node:path"
import { parse } from "acorn"
import * as walk from "acorn-walk"
import type { EntrypointDoc, MethodDoc, Param } from "./docgen-types"

// Define more complete types if needed for future use
/* 
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
*/

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
	// Updated regex to capture both forms:
	// 1. With description: this.server.tool("name", "description", {...}, async)
	// 2. Without description: this.server.tool("name", {...}, async)
	const toolRegex =
		/this\.server\.tool\(\s*["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?(?:\s*,\s*({[\s\S]+?})),\s*async/g
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

	// Extract tool description (second argument if it's a string)
	let toolDescription = `Auto-generated docs for "${toolName}" (regex-extracted)`
	const descMatch = segment.match(
		/this\.server\.tool\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']/
	)
	if (descMatch?.[1]) {
		toolDescription = descMatch[1]
	}

	// Extract schema section
	// If we have a description, schema is the third argument, otherwise it's the second
	const schemaMatch = segment.match(
		/(?:["'][^"']*["']\s*,\s*)?({[\s\S]+?}),\s*async/
	)
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
		description: toolDescription,
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
							let description = undefined

							// Check if this is a z.type() or z.type().optional() call
							if (prop.value.type === "CallExpression") {
								// New: Track the current expression to check for method chains
								let currentExpr = prop.value

								// First, try to extract the base type
								// For chains like z.number().describe().optional(), we need to traverse
								// to the root z.number() call
								let baseExpr = currentExpr
								while (
									baseExpr?.callee &&
									baseExpr.callee.type ===
										"MemberExpression" &&
									baseExpr.callee.object &&
									baseExpr.callee.object.type ===
										"CallExpression"
								) {
									baseExpr = baseExpr.callee.object
								}

								// Now baseExpr should be the z.number() call
								if (
									baseExpr?.callee &&
									baseExpr.callee.type ===
										"MemberExpression" &&
									baseExpr.callee.object &&
									baseExpr.callee.object.type ===
										"Identifier" &&
									baseExpr.callee.object.name === "z" &&
									baseExpr.callee.property &&
									baseExpr.callee.property.type ===
										"Identifier"
								) {
									paramType = baseExpr.callee.property.name
								}

								// Handle all method chains - search for .describe() and .optional()
								while (
									currentExpr &&
									currentExpr.type === "CallExpression"
								) {
									if (
										currentExpr.callee.type ===
											"MemberExpression" &&
										currentExpr.callee.property.type ===
											"Identifier"
									) {
										// Check for .optional()
										if (
											currentExpr.callee.property.name ===
											"optional"
										) {
											optional = true
										}

										// Check for .describe()
										if (
											currentExpr.callee.property.name ===
												"describe" &&
											currentExpr.arguments &&
											currentExpr.arguments.length > 0 &&
											currentExpr.arguments[0].type ===
												"Literal"
										) {
											description = currentExpr
												.arguments[0].value as string
										}
									}

									// Move to the parent expression in the chain
									currentExpr = currentExpr.callee.object
								}
							}

							console.log(
								`Found parameter via AST: ${paramName}: ${paramType}${
									optional ? " (optional)" : ""
								}${description ? ` - "${description}"` : ""}`
							)

							params.push({
								name: paramName,
								type: paramType,
								description,
								optional
							})
						}
					}
				}
			}
		})
	} catch (error) {
		console.error("Error extracting schema parameters:", error)
	}

	return params
}

/**
 * Fallback method to extract parameters using regex when AST parsing fails
 */
function extractParamsWithRegex(schemaText: string): Param[] {
	const params: Param[] = []
	// Match parameter definitions in the format: paramName: z.type().optional()
	const paramRegex =
		/(\w+):\s*z\.(\w+)\(\)(?:\.optional\(\))?(?:\.describe\(["']([^"']+)["']\))?/g
	let match: RegExpExecArray | null

	match = paramRegex.exec(schemaText)
	while (match !== null) {
		const paramName = match[1]
		const paramType = match[2]
		const optional = match[0].includes(".optional()")
		const description = match[3] || undefined

		params.push({
			name: paramName,
			type: paramType,
			description,
			optional
		})

		console.log(
			`Found parameter via regex: ${paramName}: ${paramType}${
				optional ? " (optional)" : ""
			}${description ? ` - ${description}` : ""}`
		)

		match = paramRegex.exec(schemaText)
	}

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
