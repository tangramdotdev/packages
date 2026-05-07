import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";

interface Args {
	id?: string;
	pkg?: string;
	exportName: string;
	depth: number;
	top: number;
	json: boolean;
	tangram: string;
}

interface Metadata {
	nodeSize: number;
	subtreeCount: number;
	subtreeDepth: number;
	subtreeSize: number;
}

interface DirEntry {
	name: string;
	id: string;
}

const ID_KIND = /^(dir|fil|sym|blb)_[a-z0-9]+$/;
const ID_INLINE = /(dir|fil|sym|blb)_[a-z0-9]+/g;

function parseCli(): Args {
	const { values } = parseArgs({
		options: {
			id: { type: "string" },
			pkg: { type: "string" },
			export: { type: "string", default: "default" },
			depth: { type: "string", default: "3" },
			top: { type: "string", default: "5" },
			json: { type: "boolean", default: false },
			tangram: { type: "string" },
		},
		strict: true,
	});

	if (!values.id && !values.pkg) {
		throw new Error("must provide --id <artifact> or --pkg <name>");
	}
	if (values.id && values.pkg) {
		throw new Error("provide only one of --id or --pkg");
	}

	return {
		id: values.id,
		pkg: values.pkg,
		exportName: values.export!,
		depth: Number(values.depth),
		top: Number(values.top),
		json: values.json!,
		tangram: values.tangram ?? process.env.TG_EXE ?? "tangram",
	};
}

function packagePath(name: string): string {
	const root = path.resolve(import.meta.dir, "..", "packages");
	const dirCandidate = path.join(root, name);
	if (
		fs.existsSync(dirCandidate) &&
		fs.statSync(dirCandidate).isDirectory() &&
		fs.existsSync(path.join(dirCandidate, "tangram.ts"))
	) {
		return dirCandidate;
	}
	const fileCandidate = path.join(root, `${name}.tg.ts`);
	if (fs.existsSync(fileCandidate)) {
		return fileCandidate;
	}
	throw new Error(`package not found: ${name}`);
}

async function buildPackage(
	tg: string,
	pkg: string,
	exportName: string,
): Promise<string> {
	const target = `${packagePath(pkg)}#${exportName}`;
	const out = await $`${tg} build ${target}`.text();
	for (const line of out.trim().split("\n").reverse()) {
		const trimmed = line.trim();
		if (ID_KIND.test(trimmed)) return trimmed;
	}
	throw new Error(`could not extract artifact id from build output:\n${out}`);
}

const META_CACHE = new Map<string, Promise<Metadata>>();
const ENTRIES_CACHE = new Map<string, Promise<DirEntry[]>>();
const FILE_DEPS_CACHE = new Map<string, Promise<string[]>>();

function fetchMeta(tg: string, id: string): Promise<Metadata> {
	const cached = META_CACHE.get(id);
	if (cached) return cached;
	const p = (async () => {
		const out = await $`${tg} object metadata ${id} --pretty`.quiet().text();
		const grab = (scope: string, key: string): number => {
			const re = new RegExp(
				`"${scope}"\\s*:\\s*\\{[^}]*?"${key}"\\s*:\\s*(\\d+)`,
				"s",
			);
			const m = out.match(re);
			return m ? Number(m[1]) : 0;
		};
		return {
			nodeSize: grab("node", "size"),
			subtreeCount: grab("subtree", "count"),
			subtreeDepth: grab("subtree", "depth"),
			subtreeSize: grab("subtree", "size"),
		};
	})();
	META_CACHE.set(id, p);
	return p;
}

function fetchDirEntries(tg: string, id: string): Promise<DirEntry[]> {
	const cached = ENTRIES_CACHE.get(id);
	if (cached) return cached;
	const p = (async () => {
		const out = await $`${tg} object get ${id} --depth 1 --pretty`
			.quiet()
			.text();
		const entries: DirEntry[] = [];
		for (const line of out.split("\n")) {
			const m = line.match(/^\s*"([^"]+)"\s*:\s*((?:dir|fil|sym)_[a-z0-9]+)/);
			if (m) entries.push({ name: m[1], id: m[2] });
		}
		return entries;
	})();
	ENTRIES_CACHE.set(id, p);
	return p;
}

function fetchFileDeps(tg: string, id: string): Promise<string[]> {
	const cached = FILE_DEPS_CACHE.get(id);
	if (cached) return cached;
	const p = (async () => {
		const out = await $`${tg} object get ${id} --depth 1 --pretty`
			.quiet()
			.text();
		const depsIdx = out.indexOf('"dependencies"');
		if (depsIdx === -1) return [];
		const blockStart = out.indexOf("{", depsIdx);
		if (blockStart === -1) return [];
		let depth = 0;
		let end = blockStart;
		for (; end < out.length; end++) {
			const c = out[end];
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) {
					end++;
					break;
				}
			}
		}
		const block = out.slice(blockStart, end);
		const ids = new Set<string>();
		for (const m of block.matchAll(/"item"\s*:\s*((?:dir|fil|sym)_[a-z0-9]+)/g)) {
			ids.add(m[1]);
		}
		return [...ids];
	})();
	FILE_DEPS_CACHE.set(id, p);
	return p;
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

interface SizedEntry extends DirEntry {
	meta: Metadata;
}

async function sizedEntries(
	tg: string,
	id: string,
): Promise<SizedEntry[]> {
	const entries = await fetchDirEntries(tg, id);
	const sized = await Promise.all(
		entries.map(async (e) => ({ ...e, meta: await fetchMeta(tg, e.id) })),
	);
	sized.sort((a, b) => b.meta.subtreeSize - a.meta.subtreeSize);
	return sized;
}

async function printTree(
	tg: string,
	id: string,
	name: string,
	depthRemaining: number,
	topN: number,
	prefix: string,
	branch: string,
): Promise<void> {
	const meta = await fetchMeta(tg, id);
	const kind = id.slice(0, 3);
	const tag = kind === "dir" ? `${name}/` : name;
	console.log(
		`${prefix}${branch}${tag}  ${fmtBytes(meta.subtreeSize)}  (${meta.subtreeCount} obj, depth ${meta.subtreeDepth})`,
	);
	if (depthRemaining === 0 || kind !== "dir") return;

	const entries = await sizedEntries(tg, id);
	const shown = entries.slice(0, topN);
	const childPrefix = prefix + (branch === "" ? "" : branch === "└─ " ? "   " : "│  ");
	for (let i = 0; i < shown.length; i++) {
		const isLast = i === shown.length - 1 && shown.length === entries.length;
		const childBranch = isLast ? "└─ " : "├─ ";
		await printTree(
			tg,
			shown[i].id,
			shown[i].name,
			depthRemaining - 1,
			topN,
			childPrefix,
			childBranch,
		);
	}
	if (entries.length > topN) {
		const omitted = entries
			.slice(topN)
			.reduce((acc, e) => acc + e.meta.subtreeSize, 0);
		console.log(
			`${childPrefix}└─ ... ${entries.length - topN} more  ${fmtBytes(omitted)}`,
		);
	}
}

async function collectBinaries(
	tg: string,
	id: string,
	pathPrefix: string,
	out: Array<{ path: string; id: string }>,
): Promise<void> {
	if (!id.startsWith("dir_")) return;
	const entries = await fetchDirEntries(tg, id);
	for (const e of entries) {
		const childPath = pathPrefix ? `${pathPrefix}/${e.name}` : e.name;
		if (e.id.startsWith("fil_")) {
			out.push({ path: childPath, id: e.id });
		} else if (e.id.startsWith("dir_")) {
			await collectBinaries(tg, e.id, childPath, out);
		}
	}
}

async function reportFileDeps(
	tg: string,
	rootId: string,
	topN: number,
): Promise<void> {
	const subdirs = ["bin", "sbin", "libexec"];
	const rootEntries = await fetchDirEntries(tg, rootId);
	const targets: Array<{ path: string; id: string }> = [];
	for (const sub of subdirs) {
		const entry = rootEntries.find((e) => e.name === sub);
		if (!entry || !entry.id.startsWith("dir_")) continue;
		await collectBinaries(tg, entry.id, sub, targets);
	}

	if (targets.length === 0) return;
	console.log("");
	console.log("File dependencies (wrap/embed references that pin closure):");

	const enriched = await Promise.all(
		targets.map(async (t) => {
			const deps = await fetchFileDeps(tg, t.id);
			const depMetas = await Promise.all(
				deps.map(async (d) => ({ id: d, meta: await fetchMeta(tg, d) })),
			);
			const pinned = depMetas.reduce((acc, d) => acc + d.meta.subtreeSize, 0);
			depMetas.sort((a, b) => b.meta.subtreeSize - a.meta.subtreeSize);
			return { ...t, deps: depMetas, pinned };
		}),
	);
	enriched.sort((a, b) => b.pinned - a.pinned);

	for (const t of enriched) {
		if (t.deps.length === 0) continue;
		console.log(
			`  ${t.path} → ${t.deps.length} deps, ${fmtBytes(t.pinned)} pinned`,
		);
		const shown = t.deps.slice(0, topN);
		for (const d of shown) {
			const short = `${d.id.slice(0, 12)}…`;
			console.log(
				`      ${short}  ${fmtBytes(d.meta.subtreeSize)}  (${d.meta.subtreeCount} obj)`,
			);
		}
		if (t.deps.length > topN) {
			console.log(`      … ${t.deps.length - topN} more`);
		}
	}
}

async function main(): Promise<void> {
	const args = parseCli();

	let id: string;
	let label: string;
	if (args.id) {
		id = args.id;
		label = id;
	} else {
		const pkg = args.pkg!;
		console.log(`Building ${pkg}#${args.exportName}...`);
		id = await buildPackage(args.tangram, pkg, args.exportName);
		label = `${pkg}#${args.exportName} → ${id}`;
	}

	const meta = await fetchMeta(args.tangram, id);

	if (args.json) {
		const tree = await buildJsonTree(args.tangram, id, "", args.depth);
		const fileDeps = await collectFileDepsJson(args.tangram, id);
		console.log(
			JSON.stringify(
				{ id, label, meta, tree, fileDeps },
				null,
				2,
			),
		);
		return;
	}

	console.log("");
	console.log(`Auditing: ${label}`);
	console.log(
		`Closure: ${fmtBytes(meta.subtreeSize)} across ${meta.subtreeCount} objects (depth ${meta.subtreeDepth})`,
	);
	console.log("");
	console.log("Tree breakdown (sorted by subtree size):");
	await printTree(args.tangram, id, "<root>", args.depth, args.top, "", "");
	await reportFileDeps(args.tangram, id, args.top);
}

interface JsonNode {
	name: string;
	id: string;
	size: number;
	count: number;
	children?: JsonNode[];
	truncated?: number;
}

async function buildJsonTree(
	tg: string,
	id: string,
	name: string,
	depthRemaining: number,
): Promise<JsonNode> {
	const meta = await fetchMeta(tg, id);
	const node: JsonNode = {
		name,
		id,
		size: meta.subtreeSize,
		count: meta.subtreeCount,
	};
	if (depthRemaining === 0 || !id.startsWith("dir_")) return node;
	const entries = await sizedEntries(tg, id);
	node.children = await Promise.all(
		entries.map((e) =>
			buildJsonTree(tg, e.id, e.name, depthRemaining - 1),
		),
	);
	return node;
}

interface FileDepReport {
	path: string;
	id: string;
	pinned: number;
	deps: Array<{ id: string; size: number; count: number }>;
}

async function collectFileDepsJson(
	tg: string,
	rootId: string,
): Promise<FileDepReport[]> {
	const subdirs = ["bin", "sbin", "libexec"];
	const rootEntries = await fetchDirEntries(tg, rootId);
	const targets: Array<{ path: string; id: string }> = [];
	for (const sub of subdirs) {
		const entry = rootEntries.find((e) => e.name === sub);
		if (!entry || !entry.id.startsWith("dir_")) continue;
		await collectBinaries(tg, entry.id, sub, targets);
	}
	const reports: FileDepReport[] = [];
	for (const t of targets) {
		const deps = await fetchFileDeps(tg, t.id);
		const depMetas = await Promise.all(
			deps.map(async (d) => {
				const m = await fetchMeta(tg, d);
				return { id: d, size: m.subtreeSize, count: m.subtreeCount };
			}),
		);
		const pinned = depMetas.reduce((acc, d) => acc + d.size, 0);
		depMetas.sort((a, b) => b.size - a.size);
		reports.push({ path: t.path, id: t.id, pinned, deps: depMetas });
	}
	reports.sort((a, b) => b.pinned - a.pinned);
	return reports;
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`audit failed: ${msg}`);
	process.exit(1);
});
// Suppress unused noise from helper shapes.
void ID_INLINE;
