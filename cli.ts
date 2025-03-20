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
			"tsx scripts/docgen-acorn.ts src/api/index.ts"

		// No need to update deploy script to run docgen separately since it's part of the build process
		// which is already called by the deploy script
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

This project automatically generates documentation for your MCP tools using JSDoc comments. When you run the build script, it will:

1. Generate documentation from your JSDoc comments
2. Output the documentation to \`dist/docs.json\`
3. Print the MCP JSON configuration

The deploy script calls the build script before deploying, ensuring your documentation is always up-to-date.

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
	skipDeploy: boolean,
	projectName: string
): Promise<string> {
	// Get the run command for the package manager
	const runCommand = getRunCommand(packageManager)(targetDir)
	const setupCommand =
		packageManager === "npm"
			? "npx"
			: packageManager === "yarn"
				? "yarn dlx"
				: packageManager === "pnpm"
					? "pnpm dlx"
					: "bunx"

	// No need to separately generate documentation since it's now part of the build process
	// which is called by the deploy script

	// Generate and upload secret
	console.log(pc.cyan("\n⚡️ Setting up MCP secret..."))
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
		return `${setupCommand} workers-mcp run ${projectName} http://localhost:8787 ${targetDir}`
	}

	execSync(`${setupCommand} workers-mcp secret upload`, {
		cwd: targetDir,
		stdio: "inherit"
	})

	// Deploy the worker and capture the output to extract the URL
	console.log(pc.cyan("\n⚡️ Deploying to Cloudflare Workers..."))
	let deployedUrl: string | undefined

	try {
		const deployOutput = execSync(`${runCommand} deploy`, {
			stdio: "pipe",
			encoding: "utf-8",
			cwd: targetDir
		})

		// Save the output to a file for reference and debugging
		const outputPath = join(
			targetDir,
			".wrangler",
			"deploy",
			"last-deploy-output.txt"
		)
		await mkdir(join(targetDir, ".wrangler", "deploy"), { recursive: true })
		await writeFile(outputPath, deployOutput, "utf-8")

		// Log the deploy output to the console
		console.log(deployOutput)

		// Use the helper function to extract and save the URL
		deployedUrl = await extractWorkerUrl(deployOutput, targetDir)
	} catch (error) {
		console.error(pc.red("Error during deployment:"), error)
		// Fallback to running the deploy without capturing output
		execSync(`${runCommand} deploy`, {
			stdio: "inherit",
			cwd: targetDir
		})
	}

	// Get workers-mcp executable path
	const execPath = npmWhich(targetDir).sync("workers-mcp")

	// Construct and return the MCP command with the extracted URL if available
	if (deployedUrl) {
		return `${execPath} run ${projectName} ${deployedUrl} ${targetDir}`
	}
	// Default to the standard URL format if we couldn't extract it
	return `${execPath} run ${projectName} https://${projectName}.workers.dev ${targetDir}`
}

async function getMCPCommand(
	projectName: string,
	targetDir: string,
	workerUrl?: string
) {
	// Get workers-mcp executable path
	const execPath = npmWhich(targetDir).sync("workers-mcp")

	// If a specific worker URL is provided, use it
	if (workerUrl) {
		return [execPath, "run", projectName, workerUrl, targetDir].join(" ")
	}

	// Try to find the full deployed URL from the file system
	try {
		// Check if a .wrangler/deploy directory exists with deployments info
		const deployConfigPath = join(targetDir, ".wrangler/deploy/config.json")
		if (existsSync(deployConfigPath)) {
			const deployConfig = JSON.parse(
				await readFile(deployConfigPath, "utf-8")
			)
			// Extract the deployed URL if available
			if (
				deployConfig.deployments &&
				deployConfig.deployments.length > 0
			) {
				const latestDeployment = deployConfig.deployments[0]
				if (latestDeployment.url) {
					return [
						execPath,
						"run",
						projectName,
						latestDeployment.url,
						targetDir
					].join(" ")
				}
			}
		}
	} catch (error) {
		console.log(
			pc.yellow(
				"\nCouldn't extract deployment URL from config, using default format"
			)
		)
	}

	// Default URL format if we couldn't extract from deployment output
	const defaultWorkerUrl = `https://${projectName}.workers.dev`
	return [execPath, "run", projectName, defaultWorkerUrl, targetDir].join(" ")
}

async function handleFinalSteps(
	targetDir: string,
	mcpCommand: string,
	projectName: string,
	customWorkerUrl?: string
) {
	// Get the worker URL (use custom URL if provided, otherwise use default format)
	let workerUrl = customWorkerUrl || `https://${projectName}.workers.dev`

	// Extract the actual deployed worker URL from the mcpCommand if available
	// This is particularly important to capture the full URL with account name and path
	const parts = mcpCommand.split(" ")
	const cmdWorkerUrl = parts.length > 2 ? parts[2] : undefined
	if (cmdWorkerUrl?.includes("workers.dev")) {
		workerUrl = cmdWorkerUrl
	}

	// Extract execPath from mcpCommand
	const execPath = parts.length > 0 ? parts[0] : ""

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
	const templateDir = getTemplateDir()

	// Create project directory and copy template files
	console.log(pc.cyan("\n⚡️ Creating project directory..."))
	await mkdir(targetDir, { recursive: true })

	// Copy template files
	console.log(pc.cyan("\n⚡️ Copying template files..."))
	await cp(templateDir, targetDir, {
		recursive: true
	})

	// Initialize git repository
	console.log(pc.cyan("\n⚡️ Initializing git repository..."))
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

	// No need to separately generate documentation before deployment
	// since it's now part of the build process that's called by deploy
	const runCommand = getRunCommand(packageManager)(targetDir)

	// Deploy the worker
	console.log(pc.cyan("\n⚡️ Deploying to Cloudflare Workers..."))
	let deployedUrl = ""

	try {
		const deployOutput = execSync(`${runCommand} deploy`, {
			stdio: "pipe",
			encoding: "utf-8",
			cwd: targetDir
		})

		// Save the output to a file for reference and debugging
		await mkdir(join(targetDir, ".wrangler", "deploy"), { recursive: true })
		await writeFile(
			join(targetDir, ".wrangler", "deploy", "last-deploy-output.txt"),
			deployOutput,
			"utf-8"
		)

		// Log the deploy output to the console
		console.log(deployOutput)

		// Use the helper function to extract the URL
		const extractedUrl = await extractWorkerUrl(deployOutput, targetDir)
		if (extractedUrl) {
			deployedUrl = extractedUrl
		}
	} catch (error) {
		console.error(pc.red("Error during deployment:"), error)
		// Fallback to running the deploy without capturing output
		execSync(`${runCommand} deploy`, {
			stdio: "inherit",
			cwd: targetDir
		})
	}

	// Get the worker URL from the user (with the deployed URL as default if available)
	const { workerUrl } = await prompts({
		type: "text",
		name: "workerUrl",
		message:
			"Please confirm the URL of your deployed worker (from the output above):",
		validate: (value) =>
			value.length > 0 ? true : "Worker URL is required",
		initial: deployedUrl || `https://${projectName}.workers.dev`
	})

	if (!workerUrl) {
		console.error(pc.red("Worker URL is required"))
		process.exit(1)
	}

	// Save the final confirmed URL
	if (workerUrl !== deployedUrl) {
		await saveDeploymentUrl(workerUrl, targetDir)
	}

	// Get workers-mcp executable path
	const execPath = npmWhich(targetDir).sync("workers-mcp")

	// Return the execPath for use in handleFinalSteps
	return execPath
}

// Add this helper function to extract worker URLs from deployment output
async function extractWorkerUrl(
	deployOutput: string,
	targetDir: string
): Promise<string | undefined> {
	// First try to match URLs with the pattern https://*.workers.dev/*
	const urlMatches = deployOutput.match(
		/https:\/\/([a-zA-Z0-9-]+\.)*([a-zA-Z0-9-]+\.)?workers\.dev(\/[a-zA-Z0-9-\/]*)?/g
	)
	if (urlMatches && urlMatches.length > 0) {
		// Use the last URL found as it's usually the final/complete URL
		const deployedUrl = urlMatches[urlMatches.length - 1]

		console.log(pc.green(`\n✅ Identified deployment URL: ${deployedUrl}`))
		await saveDeploymentUrl(deployedUrl, targetDir)
		return deployedUrl
	}

	// Next, try to extract URL from lines that directly mention the URL
	const directUrlMatch = deployOutput.match(
		/(?:Deployed|Published|Available at)[^\n]*?(https:\/\/[^\s\n"']+)/i
	)
	if (directUrlMatch?.[1]) {
		const deployedUrl = directUrlMatch[1]

		console.log(
			pc.green(
				`\n✅ Identified deployment URL from context: ${deployedUrl}`
			)
		)
		await saveDeploymentUrl(deployedUrl, targetDir)
		return deployedUrl
	}

	// As a last resort, check for lines containing the worker URL pattern
	const lines = deployOutput.split("\n")
	for (const line of lines) {
		if (
			line.trim().startsWith("https://") &&
			line.includes("workers.dev")
		) {
			const deployedUrl = line.trim()
			console.log(
				pc.green(`\n✅ Found worker URL in output: ${deployedUrl}`)
			)
			await saveDeploymentUrl(deployedUrl, targetDir)
			return deployedUrl
		}
	}

	console.log(
		pc.yellow(
			"\n⚠️ Could not automatically extract worker URL from deployment output."
		)
	)
	return undefined
}

// Helper to save the deployment URL to the config file
async function saveDeploymentUrl(
	url: string,
	targetDir: string
): Promise<void> {
	// Create the deployment directory if it doesn't exist
	await mkdir(join(targetDir, ".wrangler", "deploy"), { recursive: true })

	// Create a deploy config file with the URL for later reference
	const deployConfig = {
		deployments: [
			{
				timestamp: new Date().toISOString(),
				url: url
			}
		]
	}

	await writeFile(
		join(targetDir, ".wrangler", "deploy", "config.json"),
		JSON.stringify(deployConfig, null, 2),
		"utf-8"
	)
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

		if (isCloning) {
			// Using the template setup and configuration
			const execPath = await cloneExistingServer(
				githubUrl,
				projectName,
				packageManager as PackageManager
			)

			targetDir = join(process.cwd(), projectName)

			// Get the actual deployed worker URL from the deployment config if available
			try {
				const deployConfigPath = join(
					targetDir,
					".wrangler",
					"deploy",
					"config.json"
				)
				if (existsSync(deployConfigPath)) {
					const deployConfig = JSON.parse(
						await readFile(deployConfigPath, "utf-8")
					)
					if (
						deployConfig.deployments &&
						deployConfig.deployments.length > 0
					) {
						customWorkerUrl = deployConfig.deployments[0].url
						console.log(
							pc.green(
								`\n✅ Using deployed URL: ${customWorkerUrl}`
							)
						)
					}
				}
			} catch (error) {
				console.log(
					pc.yellow("\nCouldn't read deployment URL from config file")
				)
			}

			// Fall back to asking the user if we couldn't extract from config
			if (!customWorkerUrl) {
				const { workerUrl } = await prompts({
					type: "text",
					name: "workerUrl",
					message: "Please enter the URL of your deployed worker:",
					validate: (value) =>
						value.length > 0 ? true : "Worker URL is required",
					initial: `https://${projectName}.workers.dev`
				})
				customWorkerUrl = workerUrl
			}

			mcpCommand = `${execPath} run ${projectName} ${customWorkerUrl} ${targetDir}`
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
						"\n⚠️ Documentation generation is part of the build process but hasn't been run yet."
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
						} build" when you're ready to build and deploy.`
					)
				)
			} else {
				mcpCommand = await setupMCPAndWorkers(
					targetDir,
					packageManager as PackageManager,
					skipDeploy,
					projectName
				)

				// Try to get the actual worker URL from the deployment config
				try {
					const deployConfigPath = join(
						targetDir,
						".wrangler",
						"deploy",
						"config.json"
					)
					if (existsSync(deployConfigPath)) {
						const deployConfig = JSON.parse(
							await readFile(deployConfigPath, "utf-8")
						)
						if (
							deployConfig.deployments &&
							deployConfig.deployments.length > 0
						) {
							customWorkerUrl = deployConfig.deployments[0].url
							console.log(
								pc.green(
									`\n✅ Using deployed worker URL: ${customWorkerUrl}`
								)
							)
						}
					}
				} catch (error) {
					console.log(
						pc.yellow(
							"\nCouldn't read deployment URL from config file"
						)
					)
					// Fallback to default URL format
					customWorkerUrl = `https://${projectName}.workers.dev`
					console.log(
						pc.yellow(
							`\nUsing default worker URL: ${customWorkerUrl}`
						)
					)
				}
			}
		}

		// Final confirmation of the worker URL
		if (customWorkerUrl && !skipDeploy) {
			const { confirmUrl } = await prompts({
				type: "confirm",
				name: "confirmUrl",
				message: `Is this the correct worker URL? ${customWorkerUrl}`,
				initial: true
			})

			if (!confirmUrl) {
				const { newUrl } = await prompts({
					type: "text",
					name: "newUrl",
					message: "Please enter the correct worker URL:",
					validate: (value) =>
						value.length > 0 ? true : "Worker URL is required",
					initial: customWorkerUrl
				})

				if (newUrl && newUrl !== customWorkerUrl) {
					customWorkerUrl = newUrl
					console.log(
						pc.green(
							`\n✅ Updated worker URL to: ${customWorkerUrl}`
						)
					)

					// Update the deployment config with the new URL
					if (customWorkerUrl) {
						await saveDeploymentUrl(customWorkerUrl, targetDir)
					}

					// Update mcpCommand with the new URL
					const parts = mcpCommand.split(" ")
					const execPath = parts.length > 0 ? parts[0] : ""
					mcpCommand = `${execPath} run ${projectName} ${customWorkerUrl} ${targetDir}`
				}
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
