import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = await Bun.file(`${root}/packages/std/tangram.ts`).text();
const problems: Array<string> = [];
const imports = new Map(
	[...source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+"\.\/([^"]+)";/g)].map(
		([, name, path]) => [name!, path!],
	),
);
const table = source.match(
	/^const testModules:[^=]+ = \{\n([\s\S]*?)^};/m,
)?.[1];
if (table === undefined) {
	problems.push("the root module is missing the testModules table");
}
const entries = [...(table ?? "").matchAll(/^\s*"([^"]+)":\s*(\w+),?\s*$/gm)];
for (const [, path, name] of entries) {
	if (imports.get(name!) !== path) {
		problems.push(
			`${path}: the table entry must use its directly imported namespace`,
		);
	}
}

const files = new Bun.Glob("**/*.tg.ts");
for await (const path of files.scan(`${root}/packages/std`)) {
	if (path.split("/").includes("target")) continue;
	const text = await Bun.file(`${root}/packages/std/${path}`).text();
	const tests = [
		...text.matchAll(/^export\s+(?:async\s+)?function\s+(test\w*)\s*\(/gm),
	];
	for (const [, name] of text.matchAll(
		/^export\s+(?:const|let|var)\s+(test\w*)\b/gm,
	)) {
		if (name !== "tests") {
			problems.push(
				`${path}#${name}: declare the test as an exported function`,
			);
		}
	}
	for (const [, names] of text.matchAll(/^export\s*\{([^}]+)\}/gm)) {
		for (const entry of names!.split(",")) {
			const name = entry
				.trim()
				.split(/\s+as\s+/)
				.at(-1)!;
			if (/^test\w*$/.test(name)) {
				problems.push(
					`${path}#${name}: declare the test directly without an export alias`,
				);
			}
		}
	}
	if (tests.length === 0) continue;
	if (!/^export const tests\s*=\s*\{/m.test(text)) {
		problems.push(`${path}: the module is missing its tests table`);
	}
	if (entries.filter(([, key]) => key === path).length !== 1) {
		problems.push(`${path}: expected exactly one entry in testModules`);
	}
}

if (problems.length > 0) {
	console.error(
		`invalid std test registration:\n${problems.sort().join("\n")}`,
	);
	process.exit(1);
}
