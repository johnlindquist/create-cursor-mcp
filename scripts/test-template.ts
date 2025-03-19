import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import pc from "picocolors"
import tmp from "tmp"

// Enable automatic cleanup on process exit
tmp.setGracefulCleanup()

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const rootDir = join(__dirname, "..")
const cliPath = join(rootDir, "cli.ts")

// Create a temporary directory
const tmpDir = tmp.dirSync({
	prefix: "create-mcp-test-",
	unsafeCleanup: true // Remove the directory even if it's not empty
})

console.log(
	pc.cyan(
		`\n⚡️ Creating test project in temporary directory: ${tmpDir.name}\n`
	)
)

try {
	// Change to the temporary directory
	process.chdir(tmpDir.name)

	// Run the CLI with a predefined project name
	const projectName = "test-mcp-project"

	console.log(pc.cyan(`⚡️ Running CLI to create project: ${projectName}`))

	// Use the --skip-deploy flag to avoid actual deployment
	const cli = execSync(`tsx ${cliPath} --name ${projectName} --skip-deploy`, {
		stdio: "inherit",
		env: {
			...process.env,
			// Set non-interactive mode for CI environments
			CI: "true",
			// Choose pnpm as the package manager
			PREFERRED_PM: "pnpm"
		}
	})

	// Check that the output directory was created
	const projectPath = join(tmpDir.name, projectName)

	// Validate that the template files were correctly applied
	console.log(pc.cyan("\n⚡️ Validating generated project files..."))

	const requiredFiles = [
		"package.json",
		"src/index.ts",
		"wrangler.jsonc",
		"README.md"
	]

	let validationPassed = true

	for (const file of requiredFiles) {
		const filePath = join(projectPath, file)
		if (!existsSync(filePath)) {
			console.error(pc.red(`❌ Missing required file: ${file}`))
			validationPassed = false
		} else {
			console.log(pc.green(`✅ Found file: ${file}`))
		}
	}

	// Check that index.ts contains our template code (looking for the math functions)
	const indexPath = join(projectPath, "src", "index.ts")
	if (existsSync(indexPath)) {
		const content = readFileSync(indexPath, "utf8")
		// Check for class name and at least one of the math operations
		const hasTemplateCode =
			content.includes("MCPMathServer") &&
			content.includes("add") &&
			content.includes("subtract")

		if (hasTemplateCode) {
			console.log(pc.green("✅ src/index.ts contains the template code"))
		} else {
			console.error(
				pc.red(
					"❌ src/index.ts does not contain the expected template code"
				)
			)
			console.log(pc.yellow("Actual content:"))
			console.log(pc.yellow(`${content.substring(0, 500)}...`)) // Print first 500 chars for debugging
			validationPassed = false
		}
	}

	if (validationPassed) {
		console.log(
			pc.green(
				"\n✅ Template validation successful! All required files are present."
			)
		)
	} else {
		console.error(
			pc.red(
				"\n❌ Template validation failed! Some files are missing or have incorrect content."
			)
		)
		process.exit(1)
	}

	console.log(pc.green("\n✅ Test completed successfully!"))
	console.log(pc.cyan(`Project created at: ${projectPath}`))

	// Keep the directory available for inspection
	console.log(
		pc.yellow(
			"\nℹ️ The test directory will be automatically cleaned up on process exit."
		)
	)
	console.log(
		pc.yellow("To prevent cleanup and inspect the files, press Ctrl+C now.")
	)

	// Wait for a bit to allow user to cancel if they want to inspect the files
	setTimeout(() => {
		// Clean up the temporary directory
		tmpDir.removeCallback()
		console.log(pc.green("\n🧹 Temporary directory cleaned up."))
	}, 5000)
} catch (error) {
	console.error(pc.red(`\n❌ Test failed: ${error.message}`))
	process.exit(1)
}
