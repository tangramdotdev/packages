/** Tests for the packages module demonstrating variadic argument interface. */

import * as std from "./tangram.ts";

/** Assert a phase exists and narrow its type. */
const assertPhase = (
	phase: std.phases.Phase | undefined,
	name: string,
): std.phases.Phase => {
	tg.assert(phase !== undefined, `${name} phase should exist`);
	return phase;
};

/** Arg type for the first mock package with customOption. */
export type MockDepArg = std.args.BasePackageArg & {
	/** Custom option specific to mockDep. */
	customOption?: string;
};

/** Arg type for the second mock package with enableFeature. */
export type AnotherDepArg = std.args.BasePackageArg & {
	/** Feature flag specific to anotherDep. */
	enableFeature?: boolean;
};

/** Arg type for a mock autotools-style package that accepts phases. */
export type MockAutotoolsDepArg = std.autotools.Arg;

/**
 * JSON replacer that converts Tangram values to string representations.
 * Templates are converted to their string content, artifacts to their IDs.
 */
const tangramReplacer = (_key: string, value: unknown): unknown => {
	if (value instanceof tg.Template) {
		// Extract string content from template components.
		return value.components
			.map((c) => (typeof c === "string" ? c : `[artifact]`))
			.join("");
	}
	if (tg.Artifact.is(value)) {
		return `[artifact:${value.id}]`;
	}
	return value;
};

/** Create a build function that captures received args in a file. */
const createMockBuild = <T extends std.args.BasePackageArg>(
	name: string,
): std.packages.BuildFn<T> => {
	return async (...args: std.Args<T>): Promise<tg.Directory> => {
		const resolved = await std.packages.applyArgs<T>(...args);
		// Create a directory with the resolved options for verification.
		// Put in lib/ subdirectory so it survives deps filtering.
		const content = JSON.stringify(resolved, tangramReplacer, 2);
		return tg.directory({
			lib: tg.directory({
				[`${name}-args.json`]: tg.file(content),
			}),
		});
	};
};

/** Build function for mockDep that accepts MockDepArg. */
export const mockDepBuild = createMockBuild<MockDepArg>("mockDep");

/** Build function for anotherDep that accepts AnotherDepArg. */
export const anotherDepBuild = createMockBuild<AnotherDepArg>("anotherDep");

/** Build function for an autotools-style dependency that accepts phases. */
export const mockAutotoolsBuild =
	createMockBuild<MockAutotoolsDepArg>("mockAutotools");

/** Define deps using the typed mock packages. */
const testDeps = await std.deps({
	mockDep: mockDepBuild,
	anotherDep: anotherDepBuild,
});

/** Define deps with an autotools-style dependency for phase testing. */
const autotoolsTestDeps = await std.deps({
	autotoolsDep: mockAutotoolsBuild,
});

/** Package type that uses the test deps. */
export type TestPackageArg = std.autotools.Arg & std.deps.Arg<typeof testDeps>;

/** Package type for testing phase overrides with autotools-style deps. */
export type AutotoolsTestPackageArg = std.autotools.Arg &
	std.deps.Arg<typeof autotoolsTestDeps>;

/**
 * Test: Variadic arguments should allow per-dependency configuration.
 *
 * This test demonstrates the expected interface where callers can pass:
 * - Base configuration (host, target, sdk)
 * - Environment variables
 * - Per-dependency configuration including package-specific options
 * - Source overrides for dependencies
 *
 * Expected usage:
 * ```typescript
 * build(
 *   { host: "aarch64-darwin" },
 *   { env: { FOO: "bar" } },
 *   { dependencies: { mockDep: { customOption: "value1", sdk: { toolchain: "llvm" } } } },
 *   { dependencies: { anotherDep: { enableFeature: true, source: overrideDir } } }
 * )
 * ```
 *
 * The per-dependency options (customOption, enableFeature, source) should flow through
 * to each dependency's build function.
 */
export const testVariadicDependencyArgs = async () => {
	// Create a mock source directory for source override testing.
	const overrideSource = tg.directory({
		"override-marker.txt": tg.file("this is an override source"),
	});

	// Simulate calling a package with multiple variadic arguments.
	const args: std.Args<TestPackageArg> = [
		{ host: "aarch64-apple-darwin" },
		{ env: { GLOBAL_VAR: "global_value" } },
		{
			dependencies: {
				mockDep: {
					customOption: "test-value-for-mockDep",
					sdk: { toolchain: "llvm" },
				},
			},
		},
		{
			dependencies: {
				anotherDep: {
					enableFeature: true,
					env: { DEP_ONLY_VAR: "only-for-anotherDep" },
					source: overrideSource,
				},
			},
		},
	];

	// Apply the args to get resolved context.
	const resolved = await std.packages.applyArgs<TestPackageArg>(...args);

	// Verify basic resolution worked.
	tg.assert(resolved.host === "aarch64-apple-darwin");

	// Check that dependencies were collected.
	tg.assert(resolved.dependencies !== undefined, "dependencies should exist");
	const mockDepArg = resolved.dependencies.mockDep;
	const anotherDepArg = resolved.dependencies.anotherDep;

	tg.assert(mockDepArg !== undefined, "mockDep should be in dependencies");
	tg.assert(
		anotherDepArg !== undefined,
		"anotherDep should be in dependencies",
	);

	// Test that package-specific options are preserved in resolved dependencies.
	if (typeof mockDepArg !== "boolean") {
		// customOption should be preserved on the dependency arg.
		const customOption = (mockDepArg as MockDepArg).customOption;
		tg.assert(
			customOption === "test-value-for-mockDep",
			`mockDep.customOption should be 'test-value-for-mockDep', got '${customOption}'`,
		);

		// SDK options should also be preserved.
		tg.assert(mockDepArg.sdk !== undefined, "mockDep.sdk should be preserved");
	}

	if (typeof anotherDepArg !== "boolean") {
		// enableFeature should be preserved.
		const enableFeature = (anotherDepArg as AnotherDepArg).enableFeature;
		tg.assert(
			enableFeature === true,
			`anotherDep.enableFeature should be true, got '${enableFeature}'`,
		);

		// Per-dependency env should be preserved.
		tg.assert(
			anotherDepArg.env !== undefined,
			"anotherDep.env should be preserved",
		);

		// Source override should be preserved.
		tg.assert(
			anotherDepArg.source !== undefined,
			"anotherDep.source should be preserved",
		);
	}

	// Now test that deps.artifacts() properly passes the options through.
	const artifacts = await std.deps.artifacts(testDeps, resolved);

	// Read the resolved args from each built dependency.
	const mockDepDir = artifacts.mockDep;
	tg.assert(mockDepDir !== undefined, "mockDep artifact should exist");
	const mockDepJson = await mockDepDir
		.get("lib/mockDep-args.json")
		.then(tg.File.expect)
		.then((f) => f.text());
	const mockDepResolved = JSON.parse(mockDepJson);

	// The customOption should have been passed through to the mock package build.
	tg.assert(
		mockDepResolved.customOption === "test-value-for-mockDep",
		`mockDep should receive customOption='test-value-for-mockDep', got '${mockDepResolved.customOption}'`,
	);

	const anotherDepDir = artifacts.anotherDep;
	tg.assert(anotherDepDir !== undefined, "anotherDep artifact should exist");
	const anotherDepJson = await anotherDepDir
		.get("lib/anotherDep-args.json")
		.then(tg.File.expect)
		.then((f) => f.text());
	const anotherDepResolved = JSON.parse(anotherDepJson);

	// enableFeature should have been passed through.
	tg.assert(
		anotherDepResolved.enableFeature === true,
		`anotherDep should receive enableFeature=true, got '${anotherDepResolved.enableFeature}'`,
	);

	// Source override should have been passed through.
	tg.assert(
		anotherDepResolved.source !== undefined,
		"anotherDep should receive source override",
	);

	return tg.directory({ success: tg.file("all variadic arg tests passed") });
};

/**
 * Test: Phase customization using the new phases interface.
 *
 * This test demonstrates the improved phases API:
 *
 * 1. Top-level phases (NEW - reduced nesting):
 *    ```typescript
 *    build({ phases: { configure: { pre: tg`echo "pre"` } } })
 *    ```
 *
 * 2. Script vs Command body types:
 *    - Script: `tg\`make && make install\`` - full replacement
 *    - Command: `{ command: "make", args: ["install"] }` - structured, args append
 *
 * 3. Mutations for composition:
 *    - `tg.Mutation.suffix(tg\`&& echo done\`)` - append to script
 *    - `tg.Mutation.prefix(tg\`echo start &&\`)` - prepend to script
 *    - `{ args: ["--flag"] }` - append args to command
 *    - `tg.Mutation.unset()` - remove a phase
 *
 * 4. Merging order: spec phases → top-level phases → builder phases
 */
export const testPhaseOverrides = async () => {
	// Test 1: Top-level phases - reduced nesting.
	// Before: { autotools: { phases: { configure: { pre: ... } } } } (4 levels)
	// After:  { phases: { configure: { pre: ... } } } (3 levels)
	const topLevelPhasesArgs: std.Args<AutotoolsTestPackageArg> = [
		{ host: "x86_64-unknown-linux-gnu" },
		{
			phases: {
				configure: {
					pre: tg`echo "top-level pre-configure hook"`,
				},
			},
		},
	];

	const topLevelResolved =
		await std.packages.applyArgs<AutotoolsTestPackageArg>(
			...topLevelPhasesArgs,
		);

	// Verify top-level phases were collected.
	tg.assert(
		topLevelResolved.phases !== undefined,
		"top-level phases should be preserved",
	);
	const topLevelPhases = topLevelResolved.phases as std.phases.Phases;
	const topLevelConfigure = assertPhase(
		topLevelPhases.configure,
		"top-level configure",
	);
	tg.assert(
		topLevelConfigure.pre !== undefined,
		"top-level phases.configure.pre should be preserved",
	);

	// Test 2: Script body - full replacement with template.
	const scriptBodyArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				// Script body replaces the entire phase.
				build: tg`make -f Makefile.custom && make -f Makefile.custom install`,
			},
		},
	];

	const scriptResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...scriptBodyArgs,
	);
	const scriptPhases = scriptResolved.phases as std.phases.Phases;
	const scriptBuild = assertPhase(scriptPhases.build, "script build");
	tg.assert(
		std.phases.isScriptBody(scriptBuild.body),
		"build phase body should be a script (template)",
	);

	// Test 3: Command body - structured with args that append.
	const commandBodyArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				// Command body with structured command and args.
				configure: { command: "./configure", args: ["--prefix=/usr"] },
			},
		},
		{
			phases: {
				// Additional args append to existing.
				configure: { args: ["--enable-shared", "--disable-static"] },
			},
		},
	];

	const commandResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...commandBodyArgs,
	);
	const commandPhases = commandResolved.phases as std.phases.Phases;
	const commandConfigure = assertPhase(
		commandPhases.configure,
		"command configure",
	);
	tg.assert(
		std.phases.isCommandBody(commandConfigure.body),
		"configure phase body should be a command",
	);
	const configureBody = commandConfigure.body as std.phases.CommandBody;
	tg.assert(
		configureBody.args !== undefined && configureBody.args.length === 3,
		`configure args should have 3 items (merged), got ${configureBody.args?.length}`,
	);

	// Test 4: Mutation.suffix - append to a script body.
	const suffixArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				build: tg`make`,
			},
		},
		{
			phases: {
				build: tg.Mutation.suffix(tg` && echo "build complete"`),
			},
		},
	];

	const suffixResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...suffixArgs,
	);
	const suffixPhases = suffixResolved.phases as std.phases.Phases;
	const suffixBuild = assertPhase(suffixPhases.build, "suffix build");
	tg.assert(
		std.phases.isScriptBody(suffixBuild.body),
		"suffixed build should be a script",
	);
	const suffixedScript = suffixBuild.body as tg.Template;
	const suffixedText = suffixedScript.components
		.map((c) => (typeof c === "string" ? c : ""))
		.join("");
	tg.assert(
		suffixedText.includes("make") && suffixedText.includes("build complete"),
		`suffixed script should contain both parts, got: ${suffixedText}`,
	);

	// Test 5: Mutation.prefix - prepend to a script body.
	const prefixArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				install: tg`make install`,
			},
		},
		{
			phases: {
				install: tg.Mutation.prefix(tg`echo "starting install" && `),
			},
		},
	];

	const prefixResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...prefixArgs,
	);
	const prefixPhases = prefixResolved.phases as std.phases.Phases;
	const prefixInstall = assertPhase(prefixPhases.install, "prefix install");
	const prefixedScript = prefixInstall.body as tg.Template;
	const prefixedText = prefixedScript.components
		.map((c) => (typeof c === "string" ? c : ""))
		.join("");
	tg.assert(
		prefixedText.includes("starting install") &&
			prefixedText.includes("make install"),
		`prefixed script should contain both parts, got: ${prefixedText}`,
	);

	// Test 6: Mutation.unset - remove a phase.
	const unsetArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				configure: tg`./configure`,
				build: tg`make`,
				check: tg`make check`,
			},
		},
		{
			phases: {
				// Remove the check phase.
				check: tg.Mutation.unset(),
			},
		},
	];

	const unsetResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...unsetArgs,
	);
	const unsetPhases = unsetResolved.phases as std.phases.Phases;
	tg.assert(
		unsetPhases.configure !== undefined,
		"configure should still exist after unset",
	);
	tg.assert(
		unsetPhases.build !== undefined,
		"build should still exist after unset",
	);
	tg.assert(
		unsetPhases.check === undefined,
		"check phase should be undefined (unset by Mutation.unset())",
	);

	// Test 7: Pre/post hooks on phases.
	const hooksArgs: std.Args<AutotoolsTestPackageArg> = [
		{
			phases: {
				configure: {
					body: { command: "./configure", args: ["--prefix=/usr"] },
					pre: tg`echo "before configure"`,
					post: tg`echo "after configure"`,
				},
			},
		},
	];

	const hooksResolved = await std.packages.applyArgs<AutotoolsTestPackageArg>(
		...hooksArgs,
	);
	const hooksPhases = hooksResolved.phases as std.phases.Phases;
	const hooksConfigure = assertPhase(hooksPhases.configure, "hooks configure");
	tg.assert(
		hooksConfigure.pre !== undefined,
		"configure.pre hook should exist",
	);
	tg.assert(
		hooksConfigure.post !== undefined,
		"configure.post hook should exist",
	);
	tg.assert(
		std.phases.isCommandBody(hooksConfigure.body),
		"configure body should be a command",
	);

	return tg.directory({ success: tg.file("all phase override tests passed") });
};

export const testVariadicDependencyArgs_ = testVariadicDependencyArgs;
export const testPhaseOverrides_ = testPhaseOverrides;

/**
 * Test that args-only phase overrides preserve existing commands when merged.
 *
 * This replicates the ncurses bug where:
 * 1. define() has spec phases: { configure: { args: ["--with-shared"] } }
 * 2. These get pre-merged to { configure: { command: "", args: [...] } }
 * 3. Later merged with default phases: { configure: { command: "./configure", ... } }
 * 4. BUG: Empty command from (2) replaces ./configure
 *
 * The fix: Empty template commands should NOT replace existing commands.
 */
export const testArgsOnlyPhasePreservesCommand = async () => {
	// Scenario 1: Direct mergePhases call - args-only first, command second.
	// This simulates define() pre-merging spec phases, then build() merging with defaults.
	const argsOnlyPhases: std.phases.PhasesArg = {
		configure: { args: ["--with-shared", "--enable-widec"] },
	};

	const defaultPhases: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--prefix=/usr"] },
	};

	// Pre-merge the args-only phases (simulating define()).
	const preMerged = await std.phases.mergePhases(argsOnlyPhases);

	// Then merge with defaults (simulating run() reducer).
	// The order here matches how the reducer works: existing (default), override (preMerged).
	const finalPhases = await std.phases.mergePhases(defaultPhases, preMerged);

	const finalConfigure = assertPhase(finalPhases.configure, "final configure");
	tg.assert(
		std.phases.isCommandBody(finalConfigure.body),
		"configure body should be a command",
	);

	const configBody = finalConfigure.body as std.phases.CommandBody;
	const commandText = configBody.command.components
		.map((c) => (typeof c === "string" ? c : ""))
		.join("");

	tg.assert(
		commandText === "./configure",
		`configure command should be preserved as './configure', got: '${commandText}'`,
	);

	// Args should be merged: default args + override args.
	tg.assert(
		configBody.args !== undefined && configBody.args.length === 3,
		`configure args should have 3 items (merged), got ${configBody.args?.length}`,
	);

	// Scenario 2: Three-way merge (like define() does).
	const specPhases: std.phases.PhasesArg = {
		configure: { args: ["--with-cxx-shared"] },
	};
	const topLevelPhases: std.phases.PhasesArg = {
		configure: { pre: await tg`echo "pre-configure"` },
	};
	const builderPhases: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--prefix=/out"] },
	};

	// define() merges spec -> topLevel -> builder.
	const definePreMerged = await std.phases.mergePhases(
		specPhases,
		topLevelPhases,
	);

	// Then build() merges default -> definePreMerged.
	const builderDefaults: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--host=aarch64"] },
	};
	const finalThreeWay = await std.phases.mergePhases(
		builderDefaults,
		definePreMerged,
		builderPhases,
	);

	const threeWayConfigure = assertPhase(
		finalThreeWay.configure,
		"three-way configure",
	);
	const threeWayBody = threeWayConfigure.body as std.phases.CommandBody;
	const threeWayCommand = threeWayBody.command.components
		.map((c) => (typeof c === "string" ? c : ""))
		.join("");

	tg.assert(
		threeWayCommand === "./configure",
		`three-way merge should preserve command, got: '${threeWayCommand}'`,
	);

	// Pre hook should be preserved.
	tg.assert(
		threeWayConfigure.pre !== undefined,
		"pre hook should be preserved through merge",
	);

	return tg.directory({
		success: tg.file("args-only phase preserve command test passed"),
	});
};

export const testArgsOnlyPhasePreservesCommand_ =
	testArgsOnlyPhasePreservesCommand;

/**
 * Test that Mutation.unset() properly removes phases when merged in one pass.
 *
 * The correct pattern is to pass all phases to mergePhases in one call:
 * - Defaults first, then user overrides
 * - Unset mutations apply directly to remove default phases
 *
 * Note: With the new design (no PHASE_UNSET marker), calling mergePhases
 * multiple times with unset mutations won't propagate the unset. The proper
 * pattern is used by autotools.build() which spreads all phases in one call.
 */
export const testUnsetPhasePropagatesToDefaults = async () => {
	// Builder defaults (what autotools.build provides).
	const builderDefaults: std.phases.PhasesArg = {
		configure: { command: "./configure", args: ["--prefix=/usr"] },
		build: { command: "make", args: ["-j4"] },
		install: { command: "make", args: ["install"] },
	};

	// User phases with unset for configure.
	const userPhases: std.phases.PhasesArg = {
		configure: tg.Mutation.unset(),
		build: await tg`make CC="cc"`,
		install: { args: [await tg`PREFIX="${tg.output}"`] },
	};

	// Merge in one pass: defaults first, then user overrides.
	// This is how autotools.build() works after the fix.
	const finalPhases = await std.phases.mergePhases(builderDefaults, userPhases);

	// configure should be deleted (undefined) because user unset it.
	tg.assert(
		finalPhases.configure === undefined,
		"configure should be undefined (unset by user)",
	);

	// build should exist with the user's script body (replaces default).
	tg.assert(finalPhases.build !== undefined, "build phase should exist");

	// install should exist with merged args.
	tg.assert(finalPhases.install !== undefined, "install phase should exist");

	return tg.directory({
		success: tg.file("unset phase in single merge test passed"),
	});
};

export const testUnsetPhasePropagatesToDefaults_ =
	testUnsetPhasePropagatesToDefaults;

/** Run all tests. */
export const test = async () => {
	await testVariadicDependencyArgs();
	await testPhaseOverrides();
	await testArgsOnlyPhasePreservesCommand();
	await testUnsetPhasePropagatesToDefaults();
	return tg.directory({ success: tg.file("all tests passed") });
};
