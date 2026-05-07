import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";

interface Args {
	id?: string;
	pkgs: string[];
	exportName: string;
	depth: number;
	top: number;
	json: boolean;
	quick: boolean;
	full: boolean;
	concurrency: number;
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

function parseCli(): Args {
	const { values, positionals } = parseArgs({
		options: {
			id: { type: "string" },
			export: { type: "string", default: "default" },
			depth: { type: "string", default: "3" },
			top: { type: "string", default: "5" },
			json: { type: "boolean", default: false },
			quick: { type: "boolean", default: false },
			full: { type: "boolean", default: false },
			concurrency: { type: "string", default: "16" },
			tangram: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});

	const pkgs = positionals;
	if (!values.id && pkgs.length === 0) {
		throw new Error(
			"must provide --id <artifact> or one or more package names as positional args",
		);
	}
	if (values.id && pkgs.length > 0) {
		throw new Error("provide either --id or package names, not both");
	}

	return {
		id: values.id,
		pkgs,
		exportName: values.export!,
		depth: Number(values.depth),
		top: Number(values.top),
		json: values.json!,
		quick: values.quick!,
		full: values.full!,
		concurrency: Number(values.concurrency),
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
		for (const m of block.matchAll(
			/"item"\s*:\s*((?:dir|fil|sym)_[a-z0-9]+)/g,
		)) {
			ids.add(m[1]);
		}
		return [...ids];
	})();
	FILE_DEPS_CACHE.set(id, p);
	return p;
}

const CHILDREN_CACHE = new Map<string, Promise<string[]>>();

function fetchChildren(tg: string, id: string): Promise<string[]> {
	const cached = CHILDREN_CACHE.get(id);
	if (cached) return cached;
	const p = (async () => {
		const out = await $`${tg} object children ${id}`.quiet().text();
		const start = out.indexOf("[");
		if (start === -1) return [];
		try {
			return JSON.parse(out.slice(start)) as string[];
		} catch {
			return [];
		}
	})();
	CHILDREN_CACHE.set(id, p);
	return p;
}

type Kind = "dir" | "fil" | "sym" | "blb";

interface ClosureEntry {
	kind: Kind;
	parents: Set<string>;
}

function kindOf(id: string): Kind {
	const k = id.slice(0, 3);
	if (k === "dir" || k === "fil" || k === "sym" || k === "blb") return k;
	throw new Error(`unrecognized id kind: ${id}`);
}

async function walkClosure(
	tg: string,
	rootId: string,
	concurrency: number,
): Promise<Map<string, ClosureEntry>> {
	const closure = new Map<string, ClosureEntry>();
	closure.set(rootId, { kind: kindOf(rootId), parents: new Set() });
	const queue: string[] = [rootId];
	let inFlight = 0;
	return new Promise((resolve, reject) => {
		const tick = (): void => {
			if (queue.length === 0 && inFlight === 0) {
				resolve(closure);
				return;
			}
			while (queue.length > 0 && inFlight < concurrency) {
				const id = queue.shift()!;
				inFlight++;
				fetchChildren(tg, id)
					.then((children) => {
						for (const c of children) {
							let entry = closure.get(c);
							if (!entry) {
								entry = { kind: kindOf(c), parents: new Set() };
								closure.set(c, entry);
								queue.push(c);
							}
							entry.parents.add(id);
						}
						inFlight--;
						tick();
					})
					.catch(reject);
			}
		};
		tick();
	});
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

async function sizedEntries(tg: string, id: string): Promise<SizedEntry[]> {
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
	const childPrefix =
		prefix + (branch === "" ? "" : branch === "└─ " ? "   " : "│  ");
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

async function pool<T, R>(
	items: T[],
	limit: number,
	fn: (t: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = Array.from({ length: items.length });
	let i = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (true) {
				const idx = i++;
				if (idx >= items.length) return;
				results[idx] = await fn(items[idx]!);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

interface SizedClosureEntry {
	id: string;
	kind: Kind;
	refs: number;
	meta: Metadata;
}

async function sizedClosure(
	tg: string,
	closure: Map<string, ClosureEntry>,
	concurrency: number,
): Promise<SizedClosureEntry[]> {
	const ids = [...closure.keys()];
	return pool(ids, concurrency, async (id) => {
		const entry = closure.get(id)!;
		const meta = await fetchMeta(tg, id);
		return { id, kind: entry.kind, refs: entry.parents.size, meta };
	});
}

function reportHeavyHitters(sized: SizedClosureEntry[], topN: number): void {
	const ranked = [...sized].sort((a, b) => b.meta.nodeSize - a.meta.nodeSize);
	console.log("");
	console.log("Heavy hitters (top objects by individual node size):");
	for (const e of ranked.slice(0, topN)) {
		console.log(
			`  ${e.kind} ${e.id.slice(0, 16)}…  ${fmtBytes(e.meta.nodeSize)}  (${e.refs} parent${e.refs === 1 ? "" : "s"})`,
		);
	}
}

function reportDedup(sized: SizedClosureEntry[], topN: number): void {
	const shared = sized
		.filter((e) => e.refs >= 2)
		.map((e) => ({
			...e,
			savings: (e.refs - 1) * e.meta.subtreeSize,
		}));
	if (shared.length === 0) {
		console.log("");
		console.log("Dedup hot spots: none (every object has a single parent)");
		return;
	}
	shared.sort((a, b) => b.savings - a.savings);
	console.log("");
	console.log(
		"Dedup hot spots (objects referenced from multiple parents — savings vs. duplication):",
	);
	for (const e of shared.slice(0, topN)) {
		console.log(
			`  ${e.kind} ${e.id.slice(0, 16)}…  ${e.refs}×  subtree ${fmtBytes(e.meta.subtreeSize)}  (~${fmtBytes(e.savings)} dedup'd)`,
		);
	}
}

const PREFIX_LIKE = new Set([
	"bin",
	"sbin",
	"lib",
	"lib32",
	"lib64",
	"include",
	"libexec",
	"share",
	"etc",
]);

interface PinReport {
	depId: string;
	depMeta: Metadata;
	pinnedBy: string[];
	flag?: string;
	topEntries?: string[];
}

async function computePinReports(
	tg: string,
	rootId: string,
): Promise<PinReport[]> {
	const subdirs = ["bin", "sbin", "libexec"];
	const rootEntries = await fetchDirEntries(tg, rootId);
	const targets: Array<{ path: string; id: string }> = [];
	for (const sub of subdirs) {
		const entry = rootEntries.find((e) => e.name === sub);
		if (!entry || !entry.id.startsWith("dir_")) continue;
		await collectBinaries(tg, entry.id, sub, targets);
	}
	if (targets.length === 0) return [];

	const depToPaths = new Map<string, string[]>();
	for (const t of targets) {
		const deps = await fetchFileDeps(tg, t.id);
		for (const d of deps) {
			if (!d.startsWith("dir_")) continue;
			let arr = depToPaths.get(d);
			if (!arr) {
				arr = [];
				depToPaths.set(d, arr);
			}
			arr.push(t.path);
		}
	}
	if (depToPaths.size === 0) return [];

	const reports: PinReport[] = await Promise.all(
		[...depToPaths.entries()].map(async ([depId, pinnedBy]) => {
			const [depMeta, entries] = await Promise.all([
				fetchMeta(tg, depId),
				fetchDirEntries(tg, depId),
			]);
			const names = entries.map((e) => e.name);
			const prefixHits = names.filter((n) => PREFIX_LIKE.has(n));
			let flag: string | undefined;
			if (prefixHits.length >= 2) {
				flag = `looks like a package root (top-level: ${prefixHits.join(", ")})`;
			} else if (prefixHits.length === 1 && entries.length > 5) {
				flag = `single prefix dir but ${entries.length} top-level entries`;
			}
			return {
				depId,
				depMeta,
				pinnedBy,
				flag,
				topEntries: names.slice(0, 8),
			};
		}),
	);
	reports.sort((a, b) => b.depMeta.subtreeSize - a.depMeta.subtreeSize);
	return reports;
}

function printPinReports(reports: PinReport[], topN: number): void {
	if (reports.length === 0) return;
	console.log("");
	console.log(
		"Pinned dependencies of bin/sbin/libexec files (consider narrowing):",
	);
	const flagged = reports.filter((r) => r.flag);
	const unflagged = reports.filter((r) => !r.flag);
	const list = [...flagged, ...unflagged].slice(0, topN);
	for (const r of list) {
		const head = `  ${r.depId.slice(0, 16)}…  ${fmtBytes(r.depMeta.subtreeSize)}  pinned by ${r.pinnedBy.length} file${r.pinnedBy.length === 1 ? "" : "s"}`;
		const flagMark = r.flag ? "  ⚠ " + r.flag : "";
		console.log(head + flagMark);
		console.log(`      top entries: ${r.topEntries?.join(", ")}`);
		console.log(
			`      pinned by: ${r.pinnedBy.slice(0, 4).join(", ")}${r.pinnedBy.length > 4 ? `, …+${r.pinnedBy.length - 4}` : ""}`,
		);
	}
	if (reports.length > topN) {
		console.log(`  … ${reports.length - topN} more pinned dependencies`);
	}
}

interface PackageAudit {
	pkg: string;
	id: string;
	meta: Metadata;
	sized: SizedClosureEntry[];
	pinReports: PinReport[];
	uniqueSize: number;
}

async function buildAndAudit(args: Args, pkg: string): Promise<PackageAudit> {
	const id = await buildPackage(args.tangram, pkg, args.exportName);
	const meta = await fetchMeta(args.tangram, id);
	const closure = await walkClosure(args.tangram, id, args.concurrency);
	const sized = await sizedClosure(args.tangram, closure, args.concurrency);
	const pinReports = await computePinReports(args.tangram, id);
	const uniqueSize = sized.reduce((acc, e) => acc + e.meta.nodeSize, 0);
	return { pkg, id, meta, sized, pinReports, uniqueSize };
}

async function auditSingle(
	args: Args,
	id: string,
	label: string,
): Promise<void> {
	const meta = await fetchMeta(args.tangram, id);

	let sized: SizedClosureEntry[] = [];
	let uniqueSize = 0;
	if (!args.quick) {
		const closure = await walkClosure(args.tangram, id, args.concurrency);
		sized = await sizedClosure(args.tangram, closure, args.concurrency);
		uniqueSize = sized.reduce((acc, e) => acc + e.meta.nodeSize, 0);
	}

	if (args.json) {
		const tree = await buildJsonTree(args.tangram, id, "", args.depth);
		const fileDeps = await collectFileDepsJson(args.tangram, id);
		const closureSummary = args.quick
			? null
			: {
					objects: sized.length,
					uniqueSize,
					byKind: countByKind(sized),
					heavyHitters: [...sized]
						.sort((a, b) => b.meta.nodeSize - a.meta.nodeSize)
						.slice(0, args.top)
						.map((e) => ({
							id: e.id,
							kind: e.kind,
							nodeSize: e.meta.nodeSize,
							refs: e.refs,
						})),
					dedup: sized
						.filter((e) => e.refs >= 2)
						.map((e) => ({
							id: e.id,
							kind: e.kind,
							refs: e.refs,
							subtreeSize: e.meta.subtreeSize,
							savings: (e.refs - 1) * e.meta.subtreeSize,
						}))
						.sort((a, b) => b.savings - a.savings)
						.slice(0, args.top),
				};
		console.log(
			JSON.stringify(
				{ id, label, meta, tree, fileDeps, closureSummary },
				null,
				2,
			),
		);
		return;
	}

	console.log("");
	console.log(`Auditing: ${label}`);
	console.log(
		`Closure (reported, edge-counted): ${fmtBytes(meta.subtreeSize)} across ${meta.subtreeCount} refs (depth ${meta.subtreeDepth})`,
	);
	if (!args.quick) {
		const counts = countByKind(sized);
		console.log(
			`Closure (walked, unique): ${fmtBytes(uniqueSize)} across ${sized.length} objects (${counts.dir} dir, ${counts.fil} fil, ${counts.sym} sym, ${counts.blb} blb)`,
		);
	}
	console.log("");
	console.log("Tree breakdown (sorted by subtree size):");
	await printTree(args.tangram, id, "<root>", args.depth, args.top, "", "");
	await reportFileDeps(args.tangram, id, args.top);
	if (!args.quick) {
		reportHeavyHitters(sized, args.top);
		reportDedup(sized, args.top);
		const pinReports = await computePinReports(args.tangram, id);
		printPinReports(pinReports, args.top);
	}
}

async function auditSweep(args: Args, pkgs: string[]): Promise<void> {
	const audits: PackageAudit[] = [];
	for (const pkg of pkgs) {
		console.log(`Building & auditing ${pkg}#${args.exportName}...`);
		const a = await buildAndAudit(args, pkg);
		const flagged = a.pinReports.filter((r) => r.flag).length;
		console.log(
			`  ${pkg} → ${a.id.slice(0, 16)}…  ${fmtBytes(a.uniqueSize)} (${a.sized.length} obj, ${a.pinReports.length} pins, ⚠ ${flagged})`,
		);
		audits.push(a);
	}

	console.log("");
	console.log("=== Per-package summary ===");
	const colW = Math.max(...pkgs.map((p) => p.length), "package".length);
	console.log(
		`  ${"package".padEnd(colW)}  ${"reported".padStart(10)}  ${"unique".padStart(10)}  ${"objs".padStart(6)}  ${"pins".padStart(5)}  flagged`,
	);
	for (const a of audits) {
		const flagged = a.pinReports.filter((r) => r.flag).length;
		console.log(
			`  ${a.pkg.padEnd(colW)}  ${fmtBytes(a.meta.subtreeSize).padStart(10)}  ${fmtBytes(a.uniqueSize).padStart(10)}  ${a.sized.length.toString().padStart(6)}  ${a.pinReports.length.toString().padStart(5)}  ${flagged > 0 ? `⚠ ${flagged}` : "0"}`,
		);
	}

	for (const a of audits) {
		const flagged = a.pinReports.filter((r) => r.flag);
		if (flagged.length === 0 && !args.full) continue;
		console.log("");
		console.log(`-- ${a.pkg} flagged pins --`);
		printPinReports(flagged, args.top);
		if (args.full) {
			reportHeavyHitters(a.sized, args.top);
			reportDedup(a.sized, args.top);
		}
	}

	// Combined / union closure analysis.
	const idToPkgs = new Map<string, string[]>();
	const idToMeta = new Map<string, Metadata>();
	for (const a of audits) {
		for (const e of a.sized) {
			let arr = idToPkgs.get(e.id);
			if (!arr) {
				arr = [];
				idToPkgs.set(e.id, arr);
			}
			arr.push(a.pkg);
			idToMeta.set(e.id, e.meta);
		}
	}
	let unionSize = 0;
	let unionByKind: Record<Kind, number> = { dir: 0, fil: 0, sym: 0, blb: 0 };
	for (const id of idToPkgs.keys()) {
		const m = idToMeta.get(id)!;
		unionSize += m.nodeSize;
		unionByKind[kindOf(id)]++;
	}
	const unionCount = idToPkgs.size;
	const naiveSum = audits.reduce((acc, a) => acc + a.uniqueSize, 0);
	const naiveObjs = audits.reduce((acc, a) => acc + a.sized.length, 0);
	const savings = naiveSum - unionSize;
	const savingsPct = naiveSum > 0 ? (savings / naiveSum) * 100 : 0;
	const reportedSum = audits.reduce((acc, a) => acc + a.meta.subtreeSize, 0);

	console.log("");
	console.log(`=== Combined closure (union of ${pkgs.length} packages) ===`);
	console.log(
		`Union (≈ std.env(${pkgs.join(", ")}) closure): ${fmtBytes(unionSize)} across ${unionCount} unique objects`,
	);
	console.log(
		`  by kind: ${unionByKind.dir} dir, ${unionByKind.fil} fil, ${unionByKind.sym} sym, ${unionByKind.blb} blb`,
	);
	console.log(
		`Naïve sum (no cross-package sharing): ${fmtBytes(naiveSum)} across ${naiveObjs} objects`,
	);
	console.log(
		`Cross-package sharing saves: ${fmtBytes(savings)} (${savingsPct.toFixed(1)}% of naïve sum)`,
	);
	console.log(
		`Tangram-reported sum (edge-counted): ${fmtBytes(reportedSum)} — gap to walked-unique sum tells us how much in-package dedup is happening`,
	);

	const sharedAcrossPkgs = [...idToPkgs.entries()]
		.filter(([, p]) => p.length >= 2)
		.map(([id, p]) => {
			const m = idToMeta.get(id)!;
			return {
				id,
				kind: kindOf(id),
				pkgs: p,
				nodeSize: m.nodeSize,
				subtreeSize: m.subtreeSize,
			};
		});
	sharedAcrossPkgs.sort((a, b) => {
		if (b.pkgs.length !== a.pkgs.length) return b.pkgs.length - a.pkgs.length;
		return b.subtreeSize - a.subtreeSize;
	});

	if (sharedAcrossPkgs.length === 0) {
		console.log("");
		console.log(
			"No objects are shared across packages — combining offers no closure dedup beyond what each package already does.",
		);
	} else {
		console.log("");
		console.log("Most-shared objects across packages:");
		for (const e of sharedAcrossPkgs.slice(0, args.top * 2)) {
			console.log(
				`  ${e.kind} ${e.id.slice(0, 16)}…  in ${e.pkgs.length} pkgs (${e.pkgs.join(", ")})  node ${fmtBytes(e.nodeSize)}  subtree ${fmtBytes(e.subtreeSize)}`,
			);
		}
		if (sharedAcrossPkgs.length > args.top * 2) {
			console.log(
				`  … ${sharedAcrossPkgs.length - args.top * 2} more shared objects`,
			);
		}
	}
}

async function main(): Promise<void> {
	const args = parseCli();

	if (args.id) {
		await auditSingle(args, args.id, args.id);
		return;
	}
	if (args.pkgs.length === 1) {
		const pkg = args.pkgs[0]!;
		console.log(`Building ${pkg}#${args.exportName}...`);
		const id = await buildPackage(args.tangram, pkg, args.exportName);
		await auditSingle(args, id, `${pkg}#${args.exportName} → ${id}`);
		return;
	}
	await auditSweep(args, args.pkgs);
}

function countByKind(sized: SizedClosureEntry[]): Record<Kind, number> {
	const counts: Record<Kind, number> = { dir: 0, fil: 0, sym: 0, blb: 0 };
	for (const e of sized) counts[e.kind]++;
	return counts;
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
		entries.map((e) => buildJsonTree(tg, e.id, e.name, depthRemaining - 1)),
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
