export interface Param {
	name: string
	type: string
	description?: string
	optional?: boolean
}

export interface Returns {
	type: string
	description?: string
}

export interface MethodDoc {
	name: string
	description: string
	params: Param[]
	returns: Returns | null
	examples?: string[]
}

export interface StaticProperty {
	name: string
	description: string
	type: string
}

export interface EntrypointDoc {
	exported_as: string
	description: string | null
	methods: MethodDoc[]
	statics: Record<string, StaticProperty[]>
	proxy?: {
		entrypoint: string
		strategy: string
	}
}
