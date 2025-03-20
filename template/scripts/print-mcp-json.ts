#!/usr/bin/env node
import { join } from "node:path"
import npmWhich from "npm-which"
import pc from "picocolors"

/**
 * Prints complete MCP configuration as JSON
 * @param projectName The name of the MCP project
 * @param workerUrl Optional custom worker URL (default: https://{projectName}.workers.dev)
 */
async function printMcpJson(
    projectName: string = process.env.npm_package_name || "",
    workerUrl?: string
) {
    try {
        if (!projectName) {
            console.error(pc.red("Project name is required"))
            console.error(
                pc.yellow("Usage: npm run print-mcp-json [workerUrl]")
            )
            process.exit(1)
        }

        // Get the current working directory
        const targetDir = process.cwd()

        // Get workers-mcp executable path
        const execPath = npmWhich(targetDir).sync("workers-mcp")

        // Get the worker URL (default format or custom)
        const finalWorkerUrl = workerUrl || `https://${projectName}.workers.dev`

        // Create the MCP configuration object with the server in mcpServers
        const mcpConfig = {
            mcpServers: {
                [projectName]: {
                    command: execPath,
                    args: ["run", projectName, finalWorkerUrl, targetDir]
                }
            }
        }

        // Output the complete MCP configuration as JSON
        console.log("\n")
        console.log(JSON.stringify(mcpConfig, null, 2))
        console.log("\n")
        console.log(pc.green("\n✨ MCP configuration ready:"))
        console.log(
            pc.cyan(
                "Add this to your Cursor settings to use this MCP server 🚀\n"
            )
        )
    } catch (error) {
        console.error(
            pc.red("Error generating MCP configuration:"),
            error instanceof Error ? error.message : error
        )
        process.exit(1)
    }
}

// Check if this script is being run directly
if (import.meta.url.startsWith("file:")) {
    // Get optional workerUrl parameter from command line args
    const workerUrl = process.argv[2]

    // Run the function
    printMcpJson(undefined, workerUrl)
}

export { printMcpJson }
