#!/usr/bin/env node
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import npmWhich from "npm-which"
import pc from "picocolors"
import prompts from "prompts"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

// Add template directory resolution
function getTemplateDir() {
	console.log(pc.cyan("\n🔍 Looking for template directory..."))

	// Try to find template in the package directory first
	const packageTemplateDir = join(__dirname, "template")
	console.log(
		pc.yellow(`Looking in package directory: ${packageTemplateDir}`)
	)
	if (existsSync(packageTemplateDir)) {
		console.log(pc.green("Found template in package directory!"))
		return packageTemplateDir
	}

	// If not found, try to find it in the node_modules directory
	const nodeModulesTemplateDir = join(__dirname, "..", "..", "template")
	console.log(
		pc.yellow(
			`Looking in node_modules directory: ${nodeModulesTemplateDir}`
		)
	)
	if (existsSync(nodeModulesTemplateDir)) {
		console.log(pc.green("Found template in node_modules directory!"))
		return nodeModulesTemplateDir
	}

	// Try one more location - the package root
	const packageRootDir = join(__dirname, "..")
	console.log(pc.yellow(`Looking in package root: ${packageRootDir}`))
	if (existsSync(join(packageRootDir, "template"))) {
		console.log(pc.green("Found template in package root!"))
		return join(packageRootDir, "template")
	}

	console.log(
		pc.red(
			"\n❌ Template directory not found in any of the expected locations:"
		)
	)
	console.log(pc.red(`1. ${packageTemplateDir}`))
	console.log(pc.red(`2. ${nodeModulesTemplateDir}`))
	console.log(pc.red(`3. ${join(packageRootDir, "template")}`))
	console.log(pc.red(`\nCurrent __dirname: ${__dirname}`))
	throw new Error("Template directory not found")
}

const PACKAGE_MANAGERS = {
	bun: "bun install",
	npm: "npm install",
	pnpm: "pnpm install",
	yarn: "yarn"
} as const

type PackageManager = keyof typeof PACKAGE_MANAGERS

interface Args {
	name?: string
	clone?: string
	skipDeploy?: boolean
}

async function getProjectDetails() {
	// Parse command line arguments
	const argv = (await yargs(hideBin(process.argv))
		.usage("Usage: $0 --name <n> [options]")
		.option("name", {
			type: "string",
			describe: "Name of the MCP server"
		})
		.option("clone", {
			type: "string",
			describe: "GitHub URL of an existing MCP server to clone"
		})
		.option("skip-deploy", {
			type: "boolean",
			describe: "Skip the deployment step (for testing)",
			default: false
		})
		.example([
			["$0 --name my-server", "Create a new MCP server"],
			[
				"$0 --name my-server --clone https://github.com/user/repo",
				"Clone an existing MCP server"
			],
			[
				"$0 --name my-server --skip-deploy",
				"Create a new MCP server without deploying"
			]
		])
		.help().argv) as Args

	const isCloning = !!argv.clone
	const githubUrl = argv.clone || ""
	let projectName = argv.name || ""
	const skipDeploy = argv.skipDeploy || process.env.SKIP_DEPLOY === "true"

	if (isCloning && !githubUrl) {
		console.error(pc.red("GitHub URL is required when using --clone flag"))
		process.exit(1)
	}

	if (isCloning && !projectName) {
		// Extract repo name from GitHub URL
		const repoName = githubUrl.split("/").pop()?.replace(".git", "") || ""

		// Ask for project name with repo name as default
		const response = await prompts({
			type: "text",
			name: "projectName",
			message: "What is the name of your MCP server?",
			initial: repoName,
			validate: (value) =>
				value.length > 0 ? true : "Project name is required"
		})

		projectName = response.projectName
	} else if (!projectName) {
		const response = await prompts({
			type: "text",
			name: "projectName",
			message: "What is the name of your MCP server?",
			validate: (value) =>
				value.length > 0 ? true : "Project name is required"
		})

		projectName = response.projectName
	}

	if (!projectName) {
		console.error(pc.red("Project name is required"))
		process.exit(1)
	}

	// Check for preferred package manager from environment variable
	const preferredPm = process.env.PREFERRED_PM as PackageManager | undefined
	let packageManager: PackageManager

	if (preferredPm && Object.keys(PACKAGE_MANAGERS).includes(preferredPm)) {
		packageManager = preferredPm
		console.log(
			pc.cyan(
				`Using package manager: ${packageManager} (from environment)`
			)
		)
	} else {
		// Ask for package manager preference
		const response = await prompts({
			type: "select",
			name: "packageManager",
			message: "Which package manager do you want to use?",
			choices: [
				{ title: "bun", value: "bun" },
				{ title: "npm", value: "npm" },
				{ title: "pnpm", value: "pnpm" },
				{ title: "yarn", value: "yarn" }
			]
		})

		packageManager = response.packageManager

		if (!packageManager) {
			console.error(pc.red("Package manager selection is required"))
			process.exit(1)
		}
	}

	return { projectName, packageManager, githubUrl, isCloning, skipDeploy }
}

async function setupProjectFiles(projectName: string) {
	const targetDir = join(process.cwd(), projectName)
	const templateDir = getTemplateDir()

	// Create project directory
	await mkdir(targetDir, { recursive: true })

	// Copy template files
	await cp(templateDir, targetDir, {
		recursive: true
	})

	return targetDir
}

async function updateConfigurations(targetDir: string, projectName: string) {
	// Update package.json with new name
	const pkgPath = join(targetDir, "package.json")
	const pkg = JSON.parse(await readFile(pkgPath, "utf-8"))
	pkg.name = projectName

	// Add docgen script to the scripts section if it doesn't exist
	if (!pkg.scripts["docgen-acorn"]) {
		pkg.scripts["docgen-acorn"] =
			"workers-mcp docgen-acorn src/api/index.ts"

		// Update deploy script to run docgen before deployment if needed
		if (
			pkg.scripts.deploy &&
			!pkg.scripts.deploy.includes("docgen-acorn")
		) {
			// Check if npm-run-all is in devDependencies
			const hasRunAll = pkg.devDependencies?.["npm-run-all"]

			if (hasRunAll && pkg.scripts.deploy.includes("run-s")) {
				// If using run-s, add docgen to the list
				pkg.scripts.deploy = pkg.scripts.deploy.replace(
					"run-s",
					"run-s docgen-acorn"
				)
			} else if (hasRunAll) {
				// Add run-s if npm-run-all exists but not using run-s yet
				pkg.scripts.deploy = `run-s docgen-acorn ${pkg.scripts.deploy}`
			} else {
				// Since run-s isn't available, prepend the docgen script directly
				pkg.scripts.deploy = `npm run docgen-acorn && ${pkg.scripts.deploy}`

				// Add npm-run-all as a dev dependency for future use
				if (!pkg.devDependencies) {
					pkg.devDependencies = {}
				}
				pkg.devDependencies["npm-run-all"] = "^4.1.5"
			}
		}
	}

	await writeFile(pkgPath, JSON.stringify(pkg, null, 2))

	// Update wrangler.jsonc with new name
	const wranglerPath = join(targetDir, "wrangler.jsonc")
	let wranglerContent = await readFile(wranglerPath, "utf-8")
	wranglerContent = wranglerContent.replace(
		/"name":\s*"[^"]*"/,
		`"name": "${projectName}"`
	)
	await writeFile(wranglerPath, wranglerContent)

	// Update README.md heading and clone command
	const readmePath = join(targetDir, "README.md")
	let readmeContent = await readFile(readmePath, "utf-8")
	readmeContent = readmeContent.replace(/^# [^\n]+/, `# ${projectName}`)
	readmeContent = readmeContent.replace(
		/bun create mcp --clone https:\/\/github\.com\/[^/]+\/[^/\n]+/,
		`npx create-cursor-mcp --clone https://github.com/your-username/${projectName}`
	)

	// Add documentation generation info if not already present
	if (!readmeContent.includes("## Documentation Generation")) {
		readmeContent += `
## Documentation Generation

This project automatically generates documentation for your MCP tools using JSDoc comments. When you run the deploy script, it will:

1. Generate documentation from your JSDoc comments using \`pnpm run docgen-acorn\`
2. Output the documentation to \`dist/docs.json\`
3. Deploy your worker with the documentation included

This enables tools like Cursor AI to understand and properly use your MCP tools.

Example JSDoc format for MCP tools:

\`\`\`typescript
/**
 * Adds two numbers together
 * @param a {number} First number to add
 * @param b {number} Second number to add
 * @returns {number} The sum of the two numbers
 */
add(a: number, b: number) {
  return a + b;
}
\`\`\`
`
	}

	await writeFile(readmePath, readmeContent)
}

function setupDependencies(targetDir: string, packageManager: PackageManager) {
	// Initialize git repo with main branch
	execSync("git init -b main", { cwd: targetDir })

	// Install dependencies
	console.log(pc.cyan("\n⚡️ Installing dependencies..."))
	execSync(PACKAGE_MANAGERS[packageManager], {
		cwd: targetDir,
		stdio: "inherit"
	})
}

// Define a function to get the package manager run command
function getRunCommand(packageManager: PackageManager) {
	const baseCommand =
		packageManager === "npm"
			? "npm run"
			: packageManager === "yarn"
				? "yarn"
				: packageManager === "pnpm"
					? "pnpm run"
					: "bun run"

	return (targetDir: string) => `cd ${targetDir} && ${baseCommand}`
}

async function setupMCPAndWorkers(
	targetDir: string,
	packageManager: PackageManager,
	skipDeploy: boolean
) {
	console.log(
		pc.cyan("\n⚡️ Setting up MCP and deploying to Cloudflare Workers...")
	)
	const setupCommand =
		packageManager === "npm"
			? "npx"
			: packageManager === "yarn"
				? "yarn dlx"
				: packageManager === "pnpm"
					? "pnpm dlx"
					: "bunx"

	// Generate documentation first
	console.log(pc.cyan("\n⚡️ Generating API documentation..."))
	const runCommand = getRunCommand(packageManager)(targetDir)
	execSync(`${runCommand} docgen-acorn`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Generate and upload secret
	execSync(`${setupCommand} workers-mcp secret generate`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	if (skipDeploy) {
		console.log(
			pc.yellow(
				"\n⚠️ Skipping deployment (--skip-deploy flag or SKIP_DEPLOY=true was set)"
			)
		)
		return `${setupCommand} workers-mcp run ${targetDir} http://localhost:8787 ${targetDir}`
	}

	execSync(`${setupCommand} workers-mcp secret upload`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Deploy the worker
	console.log(pc.cyan("\n⚡️ Deploying to Cloudflare Workers..."))
	execSync(`${runCommand} deploy`, {
		stdio: "inherit"
	})
}

async function getMCPCommand(
	projectName: string,
	targetDir: string,
	workerUrl?: string
) {
	// Get workers-mcp executable path
	const execPath = npmWhich(targetDir).sync("workers-mcp")

	// Get the worker URL (default format or provided URL)
	const finalWorkerUrl = workerUrl || `https://${projectName}.workers.dev`

	// Construct MCP command
	return [execPath, "run", projectName, finalWorkerUrl, targetDir].join(" ")
}

async function handleFinalSteps(
	targetDir: string,
	mcpCommand: string,
	projectName: string,
	customWorkerUrl?: string
) {
	// Get the worker URL (use custom URL if provided, otherwise use default format)
	const workerUrl = customWorkerUrl || `https://${projectName}.workers.dev`

	// Extract execPath from mcpCommand
	const execPath = mcpCommand.split(" ")[0]

	// Create the complete MCP configuration object
	const mcpConfig = {
		mcpServers: {
			[projectName]: {
				command: execPath,
				args: ["run", projectName, workerUrl, targetDir]
			}
		}
	}

	// Output the MCP configuration as JSON
	console.log("\n")
	console.log(JSON.stringify(mcpConfig, null, 2))
	console.log("\n")
	console.log(pc.green("\n✨ MCP server created successfully!"))
	console.log(pc.cyan("Happy hacking! 🚀\n"))

	// Inform the user about the print-mcp-json script
	console.log(pc.yellow("📘 To get your MCP configuration JSON later, run:"))
	console.log(pc.cyan(`cd ${targetDir} && npm run print-mcp-json\n`))
}

async function cloneExistingServer(
	githubUrl: string,
	projectName: string,
	packageManager: PackageManager
) {
	const targetDir = join(process.cwd(), projectName)

	// Clone the repository
	console.log(pc.cyan("\n⚡️ Cloning repository..."))
	execSync(`git clone ${githubUrl} ${targetDir}`, { stdio: "inherit" })

	// Remove the .git folder and reinitialize the repository
	console.log(pc.cyan("\n⚡️ Initializing fresh git repository..."))
	execSync(`rm -rf ${join(targetDir, ".git")}`)
	execSync("git init -b main", { cwd: targetDir })

	// Update configurations with new name
	await updateConfigurations(targetDir, projectName)

	// Install dependencies
	console.log(pc.cyan("\n⚡️ Installing dependencies..."))
	execSync(PACKAGE_MANAGERS[packageManager], {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Generate and upload secret
	console.log(pc.cyan("\n⚡️ Setting up MCP secret..."))
	const setupCommand =
		packageManager === "npm"
			? "npx"
			: packageManager === "yarn"
				? "yarn dlx"
				: packageManager === "pnpm"
					? "pnpm dlx"
					: "bunx"

	execSync(`${setupCommand} workers-mcp secret generate`, {
		cwd: targetDir,
		stdio: "inherit"
	})
	execSync(`${setupCommand} workers-mcp secret upload`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Generate documentation before deployment
	console.log(pc.cyan("\n⚡️ Generating API documentation..."))
	const runCommand = getRunCommand(packageManager)(targetDir)
	execSync(`${runCommand} docgen-acorn`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Deploy the worker
	console.log(pc.cyan("\n⚡️ Deploying to Cloudflare Workers..."))
	execSync(`${runCommand} deploy`, {
		stdio: "inherit"
	})

	// Get the worker URL
	const { workerUrl } = await prompts({
		type: "text",
		name: "workerUrl",
		message:
			"Please enter the URL of your deployed worker (from the output above):",
		validate: (value) =>
			value.length > 0 ? true : "Worker URL is required"
	})

	if (!workerUrl) {
		console.error(pc.red("Worker URL is required"))
		process.exit(1)
	}

	// Get workers-mcp executable path
	const execPath = npmWhich(targetDir).sync("workers-mcp")

	// Return the execPath for use in handleFinalSteps
	return execPath
}

async function main() {
	// Display welcome message
	console.log("\n")
	console.log(pc.bgCyan(pc.black(" ⚡️ Welcome to create-mcp CLI ")))

	try {
		const {
			projectName,
			packageManager,
			githubUrl,
			isCloning,
			skipDeploy
		} = await getProjectDetails()

		let mcpCommand: string
		let targetDir: string
		let customWorkerUrl: string | undefined

		if (isCloning && githubUrl) {
			// For cloned repositories, get the execPath and worker URL
			const execPath = await cloneExistingServer(
				githubUrl,
				projectName,
				packageManager as PackageManager
			)

			targetDir = join(process.cwd(), projectName)

			// Get the worker URL (ask user for input in cloneExistingServer)
			const { workerUrl } = await prompts({
				type: "text",
				name: "workerUrl",
				message: "Please enter the URL of your deployed worker:",
				validate: (value) =>
					value.length > 0 ? true : "Worker URL is required",
				initial: `https://${projectName}.workers.dev`
			})

			customWorkerUrl = workerUrl
			mcpCommand = `${execPath} run ${projectName} ${workerUrl} ${targetDir}`
		} else {
			targetDir = await setupProjectFiles(projectName)
			await updateConfigurations(targetDir, projectName)
			setupDependencies(targetDir, packageManager as PackageManager)

			if (skipDeploy) {
				// If skipping deployment, just return a local command with localhost URL
				const execPath = npmWhich(targetDir).sync("workers-mcp")
				mcpCommand = `${execPath} run ${projectName} http://localhost:8787 ${targetDir}`
				customWorkerUrl = "http://localhost:8787"

				// Let user know about documentation generation
				console.log(
					pc.yellow(
						"\n⚠️ Documentation generation has been configured but not run yet."
					)
				)
				console.log(
					pc.yellow(
						`You can generate docs manually by running "${packageManager === "npm"
							? "npm run"
							: packageManager === "yarn"
								? "yarn"
								: packageManager === "pnpm"
									? "pnpm run"
									: "bun run"
						} docgen-acorn" when you're ready to deploy.`
					)
				)
			} else {
				setupMCPAndWorkers(
					targetDir,
					packageManager as PackageManager,
					skipDeploy
				)
				mcpCommand = await getMCPCommand(projectName, targetDir)
				// Default Cloudflare worker URL
				customWorkerUrl = `https://${projectName}.workers.dev`
			}
		}

		await handleFinalSteps(
			targetDir,
			mcpCommand,
			projectName,
			customWorkerUrl
		)
	} catch (error) {
		console.error(
			pc.red("Error creating project:"),
			error instanceof Error ? error.message : error
		)
		process.exit(1)
	}
}

main().catch((error) => {
	console.error(
		pc.red("Error:"),
		error instanceof Error ? error.message : error
	)
	process.exit(1)
})
