import path from "node:path"
import chalk from "chalk"
import fs from "fs-extra"
// @ts-ignore
import jsdoc from "jsdoc-api"
import filter from "just-filter-object"
import tsBlankSpace from "ts-blank-space"
import type { EntrypointDoc, Param, Returns, StaticProperty } from "./types"

type JSDocPoint = {
    comment: string
    meta: {
        range: [number, number]
        filename: string
        lineno: number
        columno: number
        path: string
        code: {
            id: string
            name: string
            type:
            | "FunctionExpression"
            | "ClassDeclaration"
            | "MethodDefinition"
            | "ClassProperty"
            | "Literal"
            paramnames: string[]
        }
    }
    undocumented: boolean
    classdesc?: string
    description: string
    name: string
    longname: string
    kind: "function" | "member" | "class"
    memberof?: string
    scope: "global" | "static" | "instance"
    async?: boolean
    params?: Array<{
        type: { names: string[] }
        description: string
        name: string
        optional?: boolean
    }>
    returns?: Array<{ type: { names: string[] }; description: string }>
    examples?: string[]
    ignore?: boolean
    tags?: Array<{
        title: string
        originalTitle: string
        text: string
        value: string
    }>
    access?: "private"
}

export async function generateDocs(filename: string) {
    if (!filename) throw new Error("Missing filename")
    const source = tsBlankSpace(fs.readFileSync(filename, "utf8"))

    const data = (
        (await jsdoc.explain({
            source: source,
            cache: true
        })) as Array<JSDocPoint>
    )
        // Pretend ignored points don't exist
        .filter((point) => !point.ignore)

    /* SEARCH FOR EXPORTED CLASSES */

    const exported_classes: Record<string, EntrypointDoc> = {}
    let default_export:
        | { class_name: string; range: [number, number] }
        | undefined
    for (const point of data) {
        // console.dir(point, { depth: null })
        // if (point.meta) console.log(source.substring(...point.meta.range))
        if (
            point.kind === "class" &&
            point.meta?.code?.type === "ClassDeclaration"
        ) {
            let exported_as = undefined
            let name = point.meta.code.name
            if (name.startsWith("exports.")) {
                name = name.slice("exports.".length)
                exported_as = name
            } else if (name === "module.exports") {
                const raw = source.substring(...point.meta.range)
                const match = raw.match(/class (\w+) (extends|{)/)
                name = match ? match[1] : "default"
                exported_as = "default"
                default_export = { class_name: name, range: point.meta.range }
            }

            const proxy = point.tags?.find(({ title }) =>
                title.startsWith("do-proxy-")
            )

            // console.dir(point, { depth: null })
            exported_classes[name] = Object.assign(
                exported_classes[name] || {},
                filter(
                    {
                        exported_as,
                        description: point.classdesc ?? null,
                        methods: [],
                        statics: {},
                        proxy: proxy
                            ? {
                                entrypoint: proxy.value,
                                strategy: proxy.title.slice(
                                    "do-proxy-".length
                                )
                            }
                            : undefined
                    },
                    (_, v) => v !== undefined
                )
            )
            // console.log(exported_classes)
        }
    }

    /* SEARCH FOR CLASS METHODS OR STATICS */

    for (const point of data) {
        // If it's a named export, we get `.memberof`. If it's a default export, we have to get creative
        const memberof =
            point.memberof === "module.exports" ||
                (!point.memberof &&
                    default_export &&
                    rangeWithin(point.meta?.range, default_export.range))
                ? default_export?.class_name
                : point.memberof

        /* CLASS METHODS */
        if (
            point.kind === "function" &&
            point.meta?.code?.type === "MethodDefinition" &&
            memberof
        ) {
            const ex = exported_classes[memberof]
            if (!ex) {
                throw new Error(
                    `Missing memberof ${memberof}. Got ${JSON.stringify(point)}, had ${JSON.stringify(Object.keys(exported_classes))}`
                )
            }

            if (point.access === "private") continue

            let returns: Returns = null
            if (point.returns) {
                const [ret, ...rest] = point.returns
                if (!ret || rest.length > 0 || ret.type?.names.length !== 1) {
                    console.log(
                        `WARN: unexpected returns value for ${JSON.stringify(point)}`
                    )
                }
                returns = {
                    description: ret.description,
                    type: ret.type.names[0]
                }
            }

            const params: Param[] = (point.params || [])
                .map(({ description, type, name, optional }) => {
                    if (type.names.length !== 1) {
                        console.log(
                            `WARN: unexpected params value for ${JSON.stringify(point)}`
                        )
                        return null
                    }

                    return { description, name, type: type.names[0], optional }
                })
                .filter((p) => p !== null)

            ex.methods.push({
                name: point.name,
                description: point.description,
                params,
                returns,
                ...(point.examples ? { examples: point.examples } : {})
            })
        }

        /* STATICS */
        if (
            point.kind === "member" &&
            point.meta?.code?.type === "ClassProperty" &&
            memberof &&
            point.meta?.range &&
            source.substring(...point.meta.range).match(/^\s*static\s/)
        ) {
            // console.dir(point, { depth: null })

            const ex = exported_classes[memberof]
            if (!ex) {
                throw new Error(
                    `Missing memberof ${memberof}. Got ${JSON.stringify(point)}, had ${JSON.stringify(Object.keys(exported_classes))}`
                )
            }

            const members: StaticProperty[] = []

            // Sadly jsdoc-api doesn't give us any reference between the members of this static property and the
            // static property itself. So we need to search the list of points for any that exist within the parent
            // property's range. I don't love having to do a nested loop (algorithmic complexity O(honey)) but this
            // is a POC and we're likely to replace jsdoc-api anyway get all the way off my back please.
            for (const subpoint of data) {
                if (
                    subpoint.meta?.code?.id !== point.meta?.code?.id &&
                    rangeWithin(subpoint.meta?.range, point.meta.range)
                ) {
                    // console.dir(subpoint, { depth: null })
                    const type =
                        subpoint.meta?.code.type === "Literal"
                            ? "string"
                            : subpoint.returns?.[0]?.type?.names?.[0]
                    members.push({
                        name: subpoint.name,
                        description: subpoint.description,
                        type
                    })
                }
            }
            ex.statics[point.name] = members
        }
    }

    /* SEARCH FOR EXPORT RENAMES */

    for (const point of data) {
        if (
            point.kind === "member" &&
            point.scope === "global" &&
            point.meta?.code?.name?.startsWith("exports.")
        ) {
            let name = point.name
            const renamed = source
                .substring(...point.meta.range)
                .match(/(\w+) as \w+/)
            if (renamed) {
                name = renamed[1]
            }
            if (exported_classes[name]) {
                exported_classes[name].exported_as = point.name
            } else {
                console.log(
                    `WARN: couldn't find which class to export for ${JSON.stringify(point)}`
                )
            }
        }
    }

    /* SEARCH FOR @do-proxy classes */
    for (const [name, cls] of Object.entries(exported_classes)) {
        if (cls.proxy) {
            const target = exported_classes[cls.proxy.entrypoint]
            if (!target)
                console.log(
                    `WARN: couldn't find which class to proxy for ${name}. Looking for ${cls.proxy.entrypoint}`
                )

            for (const method of target.methods) {
                cls.methods.push({
                    ...method,
                    ...(cls.proxy.strategy === "prepend-session-id"
                        ? {
                            params: [
                                {
                                    type: "string",
                                    name: "sessionID",
                                    description:
                                        'A unique identifier to be used for all tool calls during this conversation. Unless the user specifies explicitly which "session identifier" to use, the system should generate a completely random string of at least 8 characters.'
                                },
                                ...method.params
                            ]
                        }
                        : {})
                })
            }
            // console.log(target.methods)

            cls.proxy = undefined
        }
    }

    await fs.ensureDir("dist")
    await fs.writeFile(
        path.join("dist", "docs.json"),
        JSON.stringify(exported_classes, null, 2)
    )

    console.log(
        `Generated docs for ${chalk.green(filename)} in ${chalk.yellow("dist/docs.json")}`
    )
    console.log(
        chalk.gray(
            Object.entries(exported_classes)
                .flatMap(([k, v]) => [
                    `• ${chalk.green(k)} exported as ${chalk.green(v.exported_as)}`,
                    ...v.methods.map(
                        (m) =>
                            `  - ${chalk.yellow(m.name)}(${m.params.map((p) => `${chalk.white(p.name)}: ${p.type || "?"}`).join(", ")}): ${m.returns?.type || "?"}`
                    )
                ])
                .join("\n")
        )
    )
}

function rangeWithin(
    inner: [number, number] | undefined,
    outer: [number, number]
) {
    if (!inner) return false

    const [a, b] = inner
    const [x, y] = outer
    return a >= x && b <= y
}
