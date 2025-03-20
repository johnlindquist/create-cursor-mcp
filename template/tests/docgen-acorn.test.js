import fs from "node:fs"
import path from "node:path"
// docgen-acorn.test.js
import { describe, expect, it } from "vitest"

// Import the docs.json file
const docsPath = path.join(process.cwd(), "dist", "docs.json")
const docsJson = JSON.parse(fs.readFileSync(docsPath, "utf8"))

describe("docgen-acorn functionality", () => {
	it("should extract tool descriptions from the second string argument", () => {
		// Test the "add" tool which has a description
		const addTool = docsJson.MCPMathServer.methods.find(
			(m) => m.name === "add"
		)
		expect(addTool).toBeDefined()
		expect(addTool.description).toBe("Adds two numbers together")

		// Test the "subtract" tool which has a description
		const subtractTool = docsJson.MCPMathServer.methods.find(
			(m) => m.name === "subtract"
		)
		expect(subtractTool).toBeDefined()
		expect(subtractTool.description).toBe(
			"Subtracts the second number from the first"
		)

		// Test a tool without a custom description (should use auto-generated)
		const multiplyTool = docsJson.MCPMathServer.methods.find(
			(m) => m.name === "multiply"
		)
		expect(multiplyTool).toBeDefined()
		expect(multiplyTool.description).toContain(
			'Auto-generated docs for "multiply"'
		)
	})

	it("should extract parameter descriptions from zod.describe() calls", () => {
		// Test parameters with descriptions in the "add" tool
		const addTool = docsJson.MCPMathServer.methods.find(
			(m) => m.name === "add"
		)
		expect(addTool.params).toHaveLength(2)

		const paramA = addTool.params.find((p) => p.name === "a")
		expect(paramA).toBeDefined()
		expect(paramA.description).toBe("First number to add")
		expect(paramA.type).toBe("number")

		const paramB = addTool.params.find((p) => p.name === "b")
		expect(paramB).toBeDefined()
		expect(paramB.description).toBe("Second number to add")
		expect(paramB.type).toBe("number")

		// Test parameters without descriptions in a different tool
		const multiplyTool = docsJson.MCPMathServer.methods.find(
			(m) => m.name === "multiply"
		)
		const multiplyParamA = multiplyTool.params.find((p) => p.name === "a")
		expect(multiplyParamA).toBeDefined()
		expect(multiplyParamA.description).toBeUndefined() // No description should be undefined
		expect(multiplyParamA.type).toBe("number")
	})

	it("should correctly handle all tools in the API", () => {
		// Check that we have all 10 tools (or whatever number your API has)
		expect(docsJson.MCPMathServer.methods).toHaveLength(10)

		// Check that all tools have the correct return type
		for (const tool of docsJson.MCPMathServer.methods) {
			expect(tool.returns).toBeDefined()
			expect(tool.returns.type).toBe("string")
		}
	})
})
