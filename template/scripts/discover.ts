#!/usr/bin/env tsx
import fs from "node:fs"
import path from "node:path"
import type {
	EntrypointDoc,
	MethodDoc,
	Param,
	Returns
} from "../template/scripts/docgen-types"

// Define tool type to avoid using any
interface Tool {
	name: string
	description?: string
	inputSchema?: {
		properties?: Record<string, PropertySchema>
		required?: string[]
	}
}

interface PropertySchema {
	type?: string
	description?: string
}

/**
 * Fetches tool definitions from a worker's discover endpoint and generates a docs.json file
 */
async function discoverTools(workerUrl: string): Promise<void> {
	if (!workerUrl) {
		console.error("Please provide the Worker URL")
		process.exit(1)
	}

	try {
		// Normalize the worker URL (remove trailing slash if present)
		const normalizedUrl = workerUrl.endsWith("/")
			? workerUrl.slice(0, -1)
			: workerUrl

		// Fetch tool definitions from the discover endpoint
		console.log(`Fetching tools from ${normalizedUrl}/mcp/discover...`)
		const response = await fetch(`${normalizedUrl}/mcp/discover`)

		if (!response.ok) {
			throw new Error(
				`HTTP Error: ${response.status} - ${response.statusText}`
			)
		}

		const data = await response.json()

		// Check if we have tools in the response
		if (!data.tools || !Array.isArray(data.tools)) {
			throw new Error(
				`Invalid response format. Expected { tools: [...] } but got: ${JSON.stringify(data).substring(0, 100)}...`
			)
		}

		console.log(`Discovered ${data.tools.length} tools`)

		// Build docs.json structure
		const docsJson: Record<string, EntrypointDoc> = {
			MCPMathServer: {
				exported_as: "MCPMathServer",
				description: "Discovered tools from /mcp/discover endpoint",
				methods: data.tools.map((tool: Tool) => {
					// Extract parameters from the input schema
					const params: Param[] = []

					if (tool.inputSchema?.properties) {
						const properties = tool.inputSchema.properties
						const required = tool.inputSchema.required || []

						for (const paramName of Object.keys(properties)) {
							const paramSchema = properties[paramName]
							params.push({
								name: paramName,
								type: paramSchema.type || "any",
								description:
									paramSchema.description || undefined,
								optional: !required.includes(paramName)
							})
						}
					}

					// Create the method doc
					const methodDoc: MethodDoc = {
						name: tool.name,
						description:
							tool.description ||
							`Auto-generated docs for "${tool.name}" (regex-extracted)`,
						params,
						returns: {
							type: "string",
							description: `Result from tool "${tool.name}"`
						}
					}

					return methodDoc
				}),
				statics: {}
			}
		}

		// Create dist directory if it doesn't exist
		const distDir = path.join(process.cwd(), "dist")
		fs.mkdirSync(distDir, { recursive: true })

		// Write docs.json
		const outputPath = path.join(distDir, "docs.json")
		fs.writeFileSync(outputPath, JSON.stringify(docsJson, null, 2))

		console.log(`docs.json file successfully created at: ${outputPath}`)

		// Print a summary of the discovered tools
		console.log("\nDiscovered tools summary:")
		for (const [index, tool] of data.tools.entries()) {
			console.log(`${index + 1}. ${tool.name}`)
			if (tool.description) {
				console.log(`   Description: ${tool.description}`)
			}

			if (tool.inputSchema?.properties) {
				const required = tool.inputSchema.required || []
				console.log("   Parameters:")

				for (const [name, schema] of Object.entries<PropertySchema>(
					tool.inputSchema.properties
				)) {
					console.log(
						`   - ${name}: ${schema.type || "any"}${required.includes(name) ? "" : " (optional)"}`
					)
				}
			} else {
				console.log("   Parameters: none")
			}

			console.log("")
		}
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : String(error)
		console.error("Error discovering tools:", errorMessage)
		process.exit(1)
	}
}

// If run directly from the command line
if (require.main === module) {
	const workerUrl = process.argv[2]
	if (!workerUrl) {
		console.error("Usage: pnpm tsx scripts/discover.ts <worker-url>")
		console.error(
			"Example: pnpm tsx scripts/discover.ts https://your-worker-url.workers.dev"
		)
		process.exit(1)
	}
	discoverTools(workerUrl)
}

export { discoverTools }
