import * as autotoolsM4 from "./autotools/m4.tg.ts";
import * as autotoolsPerl from "./autotools/perl.tg.ts";
import * as bootstrap from "./bootstrap.tg.ts";
import * as bootstrapMake from "./bootstrap/make.tg.ts";
import * as bootstrapMusl from "./bootstrap/musl.tg.ts";
import * as bootstrapSdk from "./bootstrap/sdk.tg.ts";
import * as cc from "./cc.tg.ts";
import * as certificates from "./certificates.tg.ts";
import * as command_ from "./command.tg.ts";
import * as coreutils from "./utils/coreutils.tg.ts";
import * as directory from "./directory.tg.ts";
import * as download from "./download.tg.ts";
import * as env from "./env.tg.ts";
import * as file from "./file.tg.ts";
import * as image from "./image.tg.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as nativeWrapper from "./wrap/wrapper.tg.ts";
import * as packages from "./packages_test.tg.ts";
import * as phases from "./phases.tg.ts";
import * as pkgconfig from "./pkgconfig.tg.ts";
import * as process_ from "./process.tg.ts";
import * as sdk from "./sdk.tg.ts";
import * as sdkCmake from "./sdk/cmake.tg.ts";
import * as sdkDependenciesBison from "./sdk/dependencies/bison.tg.ts";
import * as sdkDependenciesFlex from "./sdk/dependencies/flex.tg.ts";
import * as sdkDependenciesGmp from "./sdk/dependencies/gmp.tg.ts";
import * as sdkDependenciesIsl from "./sdk/dependencies/isl.tg.ts";
import * as sdkDependenciesLibxcrypt from "./sdk/dependencies/libxcrypt.tg.ts";
import * as sdkDependenciesMpc from "./sdk/dependencies/mpc.tg.ts";
import * as sdkDependenciesMpfr from "./sdk/dependencies/mpfr.tg.ts";
import * as sdkDependenciesNcurses from "./sdk/dependencies/ncurses.tg.ts";
import * as sdkDependenciesPython from "./sdk/dependencies/python.tg.ts";
import * as sdkGnuBinutils from "./sdk/gnu/binutils.tg.ts";
import * as sdkGnuToolchain from "./sdk/gnu/toolchain.tg.ts";
import * as sdkKernelHeaders from "./sdk/kernel_headers.tg.ts";
import * as sdkLlvm from "./sdk/llvm.tg.ts";
import * as sdkMold from "./sdk/mold.tg.ts";
import * as sdkNinja from "./sdk/ninja.tg.ts";
import * as sdkProxy from "./sdk/proxy.tg.ts";
import * as triple from "./triple.tg.ts";
import * as utils from "./utils.tg.ts";
import * as utilsAttr from "./utils/attr.tg.ts";
import * as utilsBash from "./utils/bash.tg.ts";
import * as utilsBzip2 from "./utils/bzip2.tg.ts";
import * as utilsDiffutils from "./utils/diffutils.tg.ts";
import * as utilsFindutils from "./utils/findutils.tg.ts";
import * as utilsGawk from "./utils/gawk.tg.ts";
import * as utilsGrep from "./utils/grep.tg.ts";
import * as utilsGzip from "./utils/gzip.tg.ts";
import * as utilsLibiconv from "./utils/libiconv.tg.ts";
import * as utilsMake from "./utils/make.tg.ts";
import * as utilsPatch from "./utils/patch.tg.ts";
import * as utilsSed from "./utils/sed.tg.ts";
import * as utilsTar from "./utils/tar.tg.ts";
import * as utilsXz from "./utils/xz.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import * as wrap from "./wrap.tg.ts";

type Tier = "bootstrap" | "sdk" | "extended";

const tiers: Array<Tier> = ["bootstrap", "sdk", "extended"];

/** Every std module that exports tests, keyed by its package-relative path. The harness discovers tests only in the modules listed here, so add each new test module. */
const testModules: Record<
	string,
	[module: Record<string, unknown>, tier: Tier]
> = {
	"autotools/m4.tg.ts": [autotoolsM4, "sdk"],
	"autotools/perl.tg.ts": [autotoolsPerl, "sdk"],
	"bootstrap/make.tg.ts": [bootstrapMake, "bootstrap"],
	"bootstrap/musl.tg.ts": [bootstrapMusl, "bootstrap"],
	"bootstrap/sdk.tg.ts": [bootstrapSdk, "bootstrap"],
	"bootstrap.tg.ts": [bootstrap, "bootstrap"],
	"cc.tg.ts": [cc, "bootstrap"],
	"certificates.tg.ts": [certificates, "bootstrap"],
	"command.tg.ts": [command_, "sdk"],
	"directory.tg.ts": [directory, "bootstrap"],
	"download.tg.ts": [download, "bootstrap"],
	"env.tg.ts": [env, "bootstrap"],
	"file.tg.ts": [file, "bootstrap"],
	"image.tg.ts": [image, "bootstrap"],
	"packages_test.tg.ts": [packages, "bootstrap"],
	"phases.tg.ts": [phases, "bootstrap"],
	"pkgconfig.tg.ts": [pkgconfig, "bootstrap"],
	"process.tg.ts": [process_, "bootstrap"],
	"sdk/cmake.tg.ts": [sdkCmake, "sdk"],
	"sdk/dependencies/bison.tg.ts": [sdkDependenciesBison, "sdk"],
	"sdk/dependencies/flex.tg.ts": [sdkDependenciesFlex, "sdk"],
	"sdk/dependencies/gmp.tg.ts": [sdkDependenciesGmp, "sdk"],
	"sdk/dependencies/isl.tg.ts": [sdkDependenciesIsl, "sdk"],
	"sdk/dependencies/libxcrypt.tg.ts": [sdkDependenciesLibxcrypt, "sdk"],
	"sdk/dependencies/mpc.tg.ts": [sdkDependenciesMpc, "sdk"],
	"sdk/dependencies/mpfr.tg.ts": [sdkDependenciesMpfr, "sdk"],
	"sdk/dependencies/ncurses.tg.ts": [sdkDependenciesNcurses, "sdk"],
	"sdk/dependencies/python.tg.ts": [sdkDependenciesPython, "sdk"],
	"sdk/gnu/binutils.tg.ts": [sdkGnuBinutils, "sdk"],
	"sdk/gnu/toolchain.tg.ts": [sdkGnuToolchain, "extended"],
	"sdk/kernel_headers.tg.ts": [sdkKernelHeaders, "bootstrap"],
	"sdk/llvm.tg.ts": [sdkLlvm, "extended"],
	"sdk/mold.tg.ts": [sdkMold, "extended"],
	"sdk/ninja.tg.ts": [sdkNinja, "sdk"],
	"sdk/proxy.tg.ts": [sdkProxy, "bootstrap"],
	"sdk.tg.ts": [sdk, "extended"],
	"triple.tg.ts": [triple, "bootstrap"],
	"utils/attr.tg.ts": [utilsAttr, "bootstrap"],
	"utils/bash.tg.ts": [utilsBash, "bootstrap"],
	"utils/bzip2.tg.ts": [utilsBzip2, "bootstrap"],
	"utils/coreutils.tg.ts": [coreutils, "bootstrap"],
	"utils/diffutils.tg.ts": [utilsDiffutils, "bootstrap"],
	"utils/findutils.tg.ts": [utilsFindutils, "bootstrap"],
	"utils/gawk.tg.ts": [utilsGawk, "bootstrap"],
	"utils/grep.tg.ts": [utilsGrep, "bootstrap"],
	"utils/gzip.tg.ts": [utilsGzip, "bootstrap"],
	"utils/libiconv.tg.ts": [utilsLibiconv, "bootstrap"],
	"utils/make.tg.ts": [utilsMake, "bootstrap"],
	"utils/patch.tg.ts": [utilsPatch, "bootstrap"],
	"utils/sed.tg.ts": [utilsSed, "bootstrap"],
	"utils/tar.tg.ts": [utilsTar, "bootstrap"],
	"utils/xz.tg.ts": [utilsXz, "bootstrap"],
	"utils.tg.ts": [utils, "bootstrap"],
	"wrap/injection.tg.ts": [injection, "bootstrap"],
	"wrap/workspace.tg.ts": [workspace, "bootstrap"],
	"wrap/wrapper.tg.ts": [nativeWrapper, "bootstrap"],
	"wrap.tg.ts": [wrap, "bootstrap"],
};

/** Tests whose dependencies require a different tier from their module default. */
const testTiers: Record<string, Tier> = {
	"command.tg.ts#testCommandArgs": "bootstrap",
	"image.tg.ts#testWrappedEntrypointWithEnv": "sdk",
	"packages_test.tg.ts#testDepsEnv": "sdk",
	"process.tg.ts#testBuildTemplate": "sdk",
	"process.tg.ts#testDollar": "sdk",
	"sdk.tg.ts#testDefault": "sdk",
	"sdk/gnu/toolchain.tg.ts#testCanadianCross": "sdk",
	"sdk/proxy.tg.ts#testCrossGccLdProxy": "extended",
	"sdk/proxy.tg.ts#testDarwinToLinuxLdProxy": "extended",
	"sdk/proxy.tg.ts#testLinuxToDarwinLdProxy": "extended",
	"wrap.tg.ts#testBasicCross": "extended",
	"wrap.tg.ts#testLdLibraryPathPreservedThroughNestedWrapping": "sdk",
	"wrap.tg.ts#testLoadThroughEnvLdLibraryPath": "sdk",
	"wrap/injection.tg.ts#testCross": "extended",
	"wrap/workspace.tg.ts#testCross": "extended",
	"wrap/wrapper.tg.ts#testFull": "sdk",
};

/**
 * Run the std tests in dependency order, concurrently within each tier.
 * Bootstrap tests use prebuilt toolchains without the default SDK or utils.
 * The bootstrap tier also runs the Rust workspace unit tests and documentation tests.
 * SDK tests need the default native SDK or utils; extended tests build additional toolchains.
 * Assign each test by its most expensive supported platform.
 * A test that does not support the host logs `skipped <path>#<export>: <reason>` and returns early.
 * With no filters, run bootstrap and sdk. Tier and path filters select their intersection.
 * Use `tangram build ./packages/std#test -a list -a all` to list every test.
 * Use `tangram build ./packages/std#test -a extended -a wrap` to run the extended wrap tests.
 * Rerun a displayed name with `tangram build ./packages/std/<path>#<export>`.
 */
export async function test(...filters: Array<string>) {
	// Discover every exported test and check that each tier override names one.
	const entries: Array<{
		function: () => tg.ReturnValue;
		name: string;
		path: string;
		tier: Tier;
	}> = [];
	for (const [path, [module, tier]] of Object.entries(testModules)) {
		for (const [name, value] of Object.entries(module)) {
			if (!name.startsWith("test") || typeof value !== "function") continue;
			const qualified = `${path}#${name}`;
			entries.push({
				function: value as () => tg.ReturnValue,
				name: qualified,
				path,
				tier: testTiers[qualified] ?? tier,
			});
		}
	}
	const names = new Set(entries.map((entry) => entry.name));
	const stale = Object.keys(testTiers).filter((name) => !names.has(name));
	if (stale.length > 0) {
		throw new Error(
			`the tier overrides do not name exported tests:\n${stale.join("\n")}`,
		);
	}

	// Select the union of the tiers and the union of the module prefixes.
	const selectedTiers = new Set<Tier>();
	const paths: Array<string> = [];
	for (const filter of filters) {
		if (filter === "list") continue;
		if (filter === "all") {
			for (const tier of tiers) selectedTiers.add(tier);
		} else if (tiers.includes(filter as Tier)) {
			selectedTiers.add(filter as Tier);
		} else if (
			filter.length > 0 &&
			Object.keys(testModules).some((path) => path.startsWith(filter))
		) {
			paths.push(filter);
		} else {
			throw new Error(`unrecognized test filter: ${filter}`);
		}
	}
	if (selectedTiers.size === 0) {
		selectedTiers.add("bootstrap");
		selectedTiers.add("sdk");
	}
	const selected = entries.filter(
		(entry) =>
			selectedTiers.has(entry.tier) &&
			(paths.length === 0 || paths.some((path) => entry.path.startsWith(path))),
	);
	if (selected.length === 0) {
		throw new Error(
			`no tests match the selected tiers (${[...selectedTiers].join(", ")}) and paths (${paths.join(", ") || "all"})`,
		);
	}

	if (filters.includes("list")) {
		const names: Partial<Record<Tier, Array<string>>> = {};
		for (const tier of tiers) {
			if (!selectedTiers.has(tier)) continue;
			names[tier] = selected
				.filter((entry) => entry.tier === tier)
				.map((entry) => entry.name);
			console.log(`${tier}:\n${names[tier].join("\n")}`);
		}
		return names;
	}

	const results: Record<string, tg.Value> = {};
	for (const tier of tiers) {
		const tests = selected.filter((entry) => entry.tier === tier);
		if (tests.length === 0) continue;
		console.log(`running ${tests.length} ${tier} tests`);
		const settled = await Promise.allSettled(
			tests.map((entry) => tg.build(entry.function).named(entry.name)),
		);
		const failures: Array<string> = [];
		const errors: Array<unknown> = [];
		for (const [index, result] of settled.entries()) {
			const name = tests[index]!.name;
			if (result.status === "fulfilled") {
				results[name] = result.value;
			} else {
				const error = result.reason;
				let detail = String(error);
				if (error instanceof tg.Error) {
					try {
						// Preserve the error and its causes without loading them during failure reporting.
						detail = `error: ${await error.store()}`;
					} catch (reportError) {
						// Keep reporting the other failures if storing an error times out.
						detail += `\n  failed to store the error: ${String(reportError)}`;
					}
				}
				failures.push(`${name}: ${detail}`);
				errors.push(error);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				errors,
				`the ${tier} tier failed:\n${failures.join("\n")}`,
			);
		}
	}
	return results;
}
