import * as std from "./tangram.ts";

const assertPhase = (
	phase: std.phases.Phase | undefined,
	name: string,
): std.phases.Phase => {
	tg.assert(phase !== undefined, `${name} phase should exist`);
	return phase;
};

const readFileText = async (
	dir: tg.Directory,
	path: string,
): Promise<string> => {
	return dir
		.get(path)
		.then(tg.File.expect)
		.then((f) => f.text());
};

const templateText = (template: tg.Template): string => {
	return template.components
		.map((c) => (typeof c === "string" ? c : ""))
		.join("");
};

// Simulated builder arg type (like go.Arg or autotools.Arg).
export type MockBuilderArg = {
	flags?: Array<string>;
	prefix?: string;
};

// Shared builder (like go.build or autotools.build).
const mockBuilderBuild = (arg: MockBuilderArg = {}) => {
	const libFiles: Record<string, tg.Unresolved<tg.File>> = {};
	if (arg.flags) libFiles.flags = tg.file(arg.flags.join(","));
	if (arg.prefix) libFiles.prefix = tg.file(arg.prefix);
	return tg.directory({ lib: tg.directory(libFiles) });
};

// PkgA: distinct package that uses the shared builder.
export type PkgAArg = std.args.BasePackageArg & {
	mockBuilder?: MockBuilderArg;
	pkgAOption?: string;
};

export const pkgABuild = async (...args: std.Args<PkgAArg>) => {
	const { mockBuilder = {}, pkgAOption } =
		await std.packages.applyArgs<PkgAArg>(...args);
	const base = await mockBuilderBuild(mockBuilder);
	if (pkgAOption) {
		return tg.directory(base, {
			lib: tg.directory({ pkgAOption: tg.file(pkgAOption) }),
		});
	}
	return base;
};

// PkgB: another distinct package that uses the same builder.
export type PkgBArg = std.args.BasePackageArg & {
	mockBuilder?: MockBuilderArg;
	pkgBOption?: string;
};

export const pkgBBuild = async (...args: std.Args<PkgBArg>) => {
	const { mockBuilder = {}, pkgBOption } =
		await std.packages.applyArgs<PkgBArg>(...args);
	const base = await mockBuilderBuild(mockBuilder);
	if (pkgBOption) {
		return tg.directory(base, {
			lib: tg.directory({ pkgBOption: tg.file(pkgBOption) }),
		});
	}
	return base;
};

// FullDep: outputs bin/lib/include for kind filtering tests.
export const fullDepBuild = async (
	...args: std.Args<std.args.BasePackageArg>
) => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>(
		...args,
	);
	return tg.directory({
		bin: tg.directory({
			tool: tg.file(`host=${resolved.host}\nbuild=${resolved.build}`),
		}),
		lib: tg.directory({ "lib.a": tg.file("library") }),
		include: tg.directory({ "header.h": tg.file("header") }),
	});
};

// Deps: distinct packages with shared builder pattern, plus kind testing.
const mockDeps = await std.deps({
	pkgA: pkgABuild,
	pkgB: pkgBBuild,
	runtimeDep: fullDepBuild,
	buildtimeDep: { build: fullDepBuild, kind: "buildtime" },
	fullDep: { build: fullDepBuild, kind: "full" },
});

type MockDepsArg = std.args.BasePackageArg & std.deps.Arg<typeof mockDeps>;

// Parent/leaf for transitive dependency testing.
const leafDeps = await std.deps({ leaf: pkgABuild });

export type ParentArg = std.args.BasePackageArg &
	std.deps.Arg<typeof leafDeps> & { parentOption?: string };

export const parentBuild = async (
	...args: std.Args<ParentArg>
): Promise<tg.Directory> => {
	const resolved = await std.packages.applyArgs<ParentArg>(...args);
	const libFiles: Record<string, tg.Unresolved<tg.File>> = {};
	if (resolved.parentOption)
		libFiles.parentOption = tg.file(resolved.parentOption);
	const artifacts = await std.deps.artifacts(leafDeps, resolved);
	const leafDir = artifacts.leaf;
	if (leafDir) {
		// Read pkgAOption from leaf (which uses pkgABuild).
		const optionFile = await leafDir.tryGet("lib/pkgAOption");
		if (optionFile) {
			libFiles.leafOption = tg.file(await tg.File.expect(optionFile).text());
		}
	}
	return tg.directory({ lib: tg.directory(libFiles) });
};

const transitiveDeps = await std.deps({ parent: parentBuild });

type TransitiveArg = std.args.BasePackageArg &
	std.deps.Arg<typeof transitiveDeps>;

// Tests

const testOptionsPassToArtifacts = async () => {
	const resolved = await std.packages.applyArgs<MockDepsArg>(
		{ host: "aarch64-apple-darwin" },
		{
			dependencies: {
				// PkgA: package-specific option + builder options.
				pkgA: {
					pkgAOption: "value-for-A",
					mockBuilder: { flags: ["--enable-a"], prefix: "/opt/a" },
				},
			},
		},
		{
			dependencies: {
				// PkgB: different package, same builder key, different values.
				pkgB: {
					pkgBOption: "value-for-B",
					mockBuilder: { flags: ["--enable-b"], prefix: "/opt/b" },
				},
			},
		},
	);
	const artifacts = await std.deps.artifacts(mockDeps, resolved);

	// PkgA receives its package-specific option and builder options.
	const pkgA = artifacts.pkgA;
	tg.assert(pkgA !== undefined);
	const optionA = await readFileText(pkgA, "lib/pkgAOption");
	tg.assert(optionA === "value-for-A", `pkgA option: ${optionA}`);
	const flagsA = await readFileText(pkgA, "lib/flags");
	tg.assert(flagsA === "--enable-a", `pkgA flags: ${flagsA}`);

	// PkgB receives its own options (same builder key, different values).
	const pkgB = artifacts.pkgB;
	tg.assert(pkgB !== undefined);
	const optionB = await readFileText(pkgB, "lib/pkgBOption");
	tg.assert(optionB === "value-for-B", `pkgB option: ${optionB}`);
	const flagsB = await readFileText(pkgB, "lib/flags");
	tg.assert(flagsB === "--enable-b", `pkgB flags: ${flagsB}`);
	const prefixB = await readFileText(pkgB, "lib/prefix");
	tg.assert(prefixB === "/opt/b", `pkgB prefix: ${prefixB}`);
};

const testBaseFieldsPreserved = async () => {
	// Verify sdk, env, and source fields on dep args are preserved through applyArgs.
	const overrideSource = tg.directory({ "test.txt": tg.file("override") });
	const resolved = await std.packages.applyArgs<MockDepsArg>(
		{ host: "aarch64-apple-darwin" },
		{
			dependencies: {
				pkgA: {
					sdk: { toolchain: "llvm" },
					env: { PKG_VAR: "value" },
					source: overrideSource,
				},
			},
		},
	);

	const pkgAArg = resolved.dependencies?.pkgA;
	tg.assert(pkgAArg !== undefined && typeof pkgAArg !== "boolean");
	tg.assert(pkgAArg.sdk !== undefined, "sdk preserved");
	tg.assert(pkgAArg.env !== undefined, "env preserved");
	tg.assert(pkgAArg.source !== undefined, "source preserved");
};

const testTransitiveDependencyArgs = async () => {
	const resolved = await std.packages.applyArgs<TransitiveArg>(
		{ host: "aarch64-apple-darwin" },
		{
			dependencies: {
				parent: {
					parentOption: "parent-value",
					dependencies: { leaf: { pkgAOption: "transitive-leaf-value" } },
				},
			},
		},
	);
	const artifacts = await std.deps.artifacts(transitiveDeps, resolved);
	const parentDir = artifacts.parent;
	tg.assert(parentDir !== undefined);

	const parentOption = await readFileText(parentDir, "lib/parentOption");
	tg.assert(parentOption === "parent-value", `parentOption: ${parentOption}`);

	const leafOption = await readFileText(parentDir, "lib/leafOption");
	tg.assert(
		leafOption === "transitive-leaf-value",
		`leafOption: ${leafOption}`,
	);
};

const testKindSubdirectoryFiltering = async () => {
	const resolved = await std.packages.applyArgs<MockDepsArg>({
		build: "x86_64-unknown-linux-gnu",
		host: "aarch64-unknown-linux-gnu",
	});
	const artifacts = await std.deps.artifacts(mockDeps, resolved);

	// Runtime keeps lib and include, not bin.
	const runtime = artifacts.runtimeDep;
	tg.assert(runtime !== undefined);
	tg.assert((await runtime.tryGet("lib")) !== undefined, "runtime has lib");
	tg.assert(
		(await runtime.tryGet("include")) !== undefined,
		"runtime has include",
	);
	tg.assert((await runtime.tryGet("bin")) === undefined, "runtime no bin");

	// Buildtime keeps only bin.
	const buildtime = artifacts.buildtimeDep;
	tg.assert(buildtime !== undefined);
	tg.assert((await buildtime.tryGet("bin")) !== undefined, "buildtime has bin");
	tg.assert((await buildtime.tryGet("lib")) === undefined, "buildtime no lib");

	// Full keeps everything.
	const full = artifacts.fullDep;
	tg.assert(full !== undefined);
	tg.assert((await full.tryGet("bin")) !== undefined, "full has bin");
	tg.assert((await full.tryGet("lib")) !== undefined, "full has lib");
	tg.assert((await full.tryGet("include")) !== undefined, "full has include");
};

const testBuildtimeKindSetsBuildAsHost = async () => {
	const resolved = await std.packages.applyArgs<MockDepsArg>({
		build: "x86_64-unknown-linux-gnu",
		host: "aarch64-unknown-linux-gnu",
	});
	const artifacts = await std.deps.artifacts(mockDeps, resolved);

	const buildtime = artifacts.buildtimeDep;
	tg.assert(buildtime !== undefined);
	const toolContent = await readFileText(buildtime, "bin/tool");
	tg.assert(
		toolContent.includes("host=x86_64-unknown-linux-gnu"),
		`buildtime should have host=build: ${toolContent}`,
	);

	const full = artifacts.fullDep;
	tg.assert(full !== undefined);
	const fullContent = await readFileText(full, "bin/tool");
	tg.assert(
		fullContent.includes("host=aarch64-unknown-linux-gnu"),
		`full keeps original host: ${fullContent}`,
	);
};

const testDepsEnv = async () => {
	const resolved = await std.packages.applyArgs<MockDepsArg>({
		host: "x86_64-unknown-linux-gnu",
		dependencies: { pkgA: { pkgAOption: "test-env" } },
	});
	const env = await std.deps.env(mockDeps, resolved);
	tg.assert(env !== undefined, "deps.env returns env object");
	tg.assert(typeof env === "object", "env is an object");
};

const testBooleanFlags = async () => {
	// false disables dependency.
	const resolved1 = await std.packages.applyArgs<MockDepsArg>({
		host: "x86_64-unknown-linux-gnu",
		dependencies: { runtimeDep: false },
	});
	const artifacts1 = await std.deps.artifacts(mockDeps, resolved1);
	tg.assert(artifacts1.runtimeDep === undefined, "false disables dep");
	tg.assert(artifacts1.buildtimeDep !== undefined, "other deps still build");

	// true uses defaults.
	const resolved2 = await std.packages.applyArgs<MockDepsArg>({
		host: "x86_64-unknown-linux-gnu",
		dependencies: { runtimeDep: true },
	});
	const artifacts2 = await std.deps.artifacts(mockDeps, resolved2);
	tg.assert(artifacts2.runtimeDep !== undefined, "true builds with defaults");

	// true then false: later false overrides earlier true.
	const resolved3 = await std.packages.applyArgs<MockDepsArg>(
		{ host: "x86_64-unknown-linux-gnu", dependencies: { runtimeDep: true } },
		{ dependencies: { runtimeDep: false } },
	);
	tg.assert(
		resolved3.dependencies?.runtimeDep === false,
		"later false overrides true",
	);
};

const testMergeOrder = async () => {
	const resolved = await std.packages.applyArgs<MockDepsArg>(
		{ dependencies: { pkgA: { pkgAOption: "first" } } },
		{ dependencies: { pkgA: { pkgAOption: "second" } } },
	);
	const pkgAArg = resolved.dependencies?.pkgA;
	tg.assert(pkgAArg !== undefined && typeof pkgAArg !== "boolean");
	tg.assert(
		(pkgAArg as PkgAArg).pkgAOption === "second",
		"later overrides earlier",
	);

	// Multiple different deps across variadic args merge together.
	const resolved2 = await std.packages.applyArgs<MockDepsArg>(
		{
			host: "x86_64-unknown-linux-gnu",
			dependencies: { pkgA: { pkgAOption: "A" } },
		},
		{ dependencies: { pkgB: { pkgBOption: "B" } } },
	);
	const pkgA2 = resolved2.dependencies?.pkgA;
	const pkgB2 = resolved2.dependencies?.pkgB;
	tg.assert(pkgA2 !== undefined && typeof pkgA2 !== "boolean", "pkgA present");
	tg.assert(pkgB2 !== undefined && typeof pkgB2 !== "boolean", "pkgB present");
	tg.assert((pkgA2 as PkgAArg).pkgAOption === "A", "pkgA option preserved");
	tg.assert((pkgB2 as PkgBArg).pkgBOption === "B", "pkgB option preserved");

	// Arg without dependencies field is handled correctly.
	const resolved3 = await std.packages.applyArgs<MockDepsArg>(
		{ host: "x86_64-unknown-linux-gnu" },
		{ dependencies: { pkgA: { pkgAOption: "after-missing" } } },
	);
	const pkgA3 = resolved3.dependencies?.pkgA;
	tg.assert(pkgA3 !== undefined && typeof pkgA3 !== "boolean");
	tg.assert(
		(pkgA3 as PkgAArg).pkgAOption === "after-missing",
		"missing dependencies handled, later arg applied",
	);
};

const testBuildDefaultsToHost = async () => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>({
		host: "aarch64-apple-darwin",
	});
	tg.assert(
		resolved.build === "aarch64-apple-darwin",
		"build defaults to host",
	);

	const resolved2 = await std.packages.applyArgs<std.args.BasePackageArg>({});
	tg.assert(resolved2.build === resolved2.host, "both match when unspecified");
};

// Phase tests

const testTopLevelPhases = async () => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>(
		{ host: "x86_64-unknown-linux-gnu" },
		{ phases: { configure: { pre: tg`echo "pre-configure"` } } },
	);
	const phases = resolved.phases as std.phases.Phases;
	const configure = assertPhase(phases.configure, "configure");
	tg.assert(configure.pre !== undefined, "pre hook preserved");
};

const testScriptBody = async () => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>({
		phases: { build: tg`make -f Makefile.custom` },
	});
	const phases = resolved.phases as std.phases.Phases;
	const build = assertPhase(phases.build, "build");
	tg.assert(std.phases.isScriptBody(build.body), "body is script");
};

const testCommandBody = async () => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>(
		{
			phases: {
				configure: { command: "./configure", args: ["--prefix=/usr"] },
			},
		},
		{ phases: { configure: { args: ["--enable-shared"] } } },
	);
	const phases = resolved.phases as std.phases.Phases;
	const configure = assertPhase(phases.configure, "configure");
	tg.assert(std.phases.isCommandBody(configure.body), "body is command");
	const body = configure.body as std.phases.CommandBody;
	tg.assert(body.args?.length === 2, `args merged: ${body.args?.length}`);
};

const testMutations = async () => {
	// Suffix
	const resolved1 = await std.packages.applyArgs<std.args.BasePackageArg>(
		{ phases: { build: tg`make` } },
		{ phases: { build: tg.Mutation.suffix(tg` && echo done`) } },
	);
	const build1 = assertPhase(
		(resolved1.phases as std.phases.Phases).build,
		"suffix",
	);
	const text1 = templateText(build1.body as tg.Template);
	tg.assert(text1.includes("make") && text1.includes("done"), "suffix works");

	// Prefix
	const resolved2 = await std.packages.applyArgs<std.args.BasePackageArg>(
		{ phases: { install: tg`make install` } },
		{ phases: { install: tg.Mutation.prefix(tg`echo start && `) } },
	);
	const install = assertPhase(
		(resolved2.phases as std.phases.Phases).install,
		"prefix",
	);
	const text2 = templateText(install.body as tg.Template);
	tg.assert(
		text2.includes("start") && text2.includes("make install"),
		"prefix works",
	);

	// Unset
	const resolved3 = await std.packages.applyArgs<std.args.BasePackageArg>(
		{ phases: { configure: tg`./configure`, check: tg`make check` } },
		{ phases: { check: tg.Mutation.unset() } },
	);
	const phases3 = resolved3.phases as std.phases.Phases;
	tg.assert(phases3.configure !== undefined, "configure exists");
	tg.assert(phases3.check === undefined, "check unset");
};

const testPhaseHooks = async () => {
	const resolved = await std.packages.applyArgs<std.args.BasePackageArg>({
		phases: {
			configure: {
				body: { command: "./configure", args: ["--prefix=/usr"] },
				pre: tg`echo before`,
				post: tg`echo after`,
			},
		},
	});
	const configure = assertPhase(
		(resolved.phases as std.phases.Phases).configure,
		"hooks",
	);
	tg.assert(configure.pre !== undefined, "pre exists");
	tg.assert(configure.post !== undefined, "post exists");
	tg.assert(std.phases.isCommandBody(configure.body), "body is command");
};

const testPhaseMerge = async () => {
	// Args-only phase preserves command from defaults.
	const argsOnly: std.phases.PhasesArg = {
		configure: { args: ["--with-shared"] },
	};
	const defaults: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--prefix=/usr"] },
	};
	const merged = await std.phases.mergePhases(
		defaults,
		await std.phases.mergePhases(argsOnly),
	);
	const configure = assertPhase(merged.configure, "merge");
	const body = configure.body as std.phases.CommandBody;
	tg.assert(templateText(body.command) === "./configure", "command preserved");
	tg.assert(body.args?.length === 2, "args merged");

	// Unset propagates.
	const userPhases: std.phases.PhasesArg = {
		configure: tg.Mutation.unset(),
		build: await tg`make`,
	};
	const final = await std.phases.mergePhases(defaults, userPhases);
	tg.assert(final.configure === undefined, "unset propagates");
	tg.assert(final.build !== undefined, "build exists");

	// Three-way merge preserves pre hooks.
	const specPhases: std.phases.PhasesArg = {
		configure: { args: ["--with-cxx-shared"] },
	};
	const topLevelPhases: std.phases.PhasesArg = {
		configure: { pre: await tg`echo "pre-configure"` },
	};
	const builderDefaults: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--host=aarch64"] },
	};
	const preMerged = await std.phases.mergePhases(specPhases, topLevelPhases);
	const threeWay = await std.phases.mergePhases(builderDefaults, preMerged);
	const threeWayConfigure = assertPhase(threeWay.configure, "three-way");
	tg.assert(threeWayConfigure.pre !== undefined, "pre hook preserved");
	const threeWayBody = threeWayConfigure.body as std.phases.CommandBody;
	tg.assert(
		templateText(threeWayBody.command) === "./configure",
		"command preserved in three-way",
	);
};

export const test = async () => {
	await Promise.all([
		testOptionsPassToArtifacts(),
		testBaseFieldsPreserved(),
		testTransitiveDependencyArgs(),
		testKindSubdirectoryFiltering(),
		testBuildtimeKindSetsBuildAsHost(),
		testDepsEnv(),
		testBooleanFlags(),
		testMergeOrder(),
		testBuildDefaultsToHost(),
		testTopLevelPhases(),
		testScriptBody(),
		testCommandBody(),
		testMutations(),
		testPhaseHooks(),
		testPhaseMerge(),
	]);
	return true;
};
