/** Benchmark harness for tgrustc proxy performance analysis.
 *
 * Compares three scenarios for each test project:
 * - Baseline: cargo.build without tgrustc, using a timing wrapper to measure per-crate durations.
 * - Proxy cold: cargo.build with tgrustc, all crates are cache misses.
 * - Proxy warm: cargo.build with tgrustc after cache is populated, deps are cache hits.
 *
 * Usage:
 *   tangram build ./packages/rust/benchmark.tg.ts#benchmarkParallelDeps
 *   tangram build ./packages/rust/benchmark.tg.ts#benchmarkAll
 */

import { cargo } from "./tangram.ts";
import {
	type RustcStats,
	buildWithStats,
	parseStats,
	summarizeStats,
} from "./proxy.tg.ts";

import tests from "./tests" with { type: "directory" };

/** Configuration for a single benchmark project. */
type BenchmarkConfig = {
	/** Display name for this benchmark. */
	name: string;
	/** Source directory for the project. */
	source: tg.Unresolved<tg.Directory>;
	/** Path to the leaf binary crate's main source file. */
	leafPath: string;
	/** Additional cargo.build arguments. */
	cargoArgs?: Partial<cargo.Arg>;
};

/** Per-crate timing from the baseline (no proxy) timing wrapper. */
type BaselineTiming = {
	crate_name: string;
	elapsed_ms: number;
};

/** Per-crate stats summary. */
type StatsSummary = {
	hits: number;
	misses: number;
	totalMs: number;
	crates: number;
};

/** Result of running all scenarios for one project. */
type BenchmarkResult = {
	name: string;
	baselineTimings: Array<BaselineTiming> | undefined;
	baselineTotalMs: number | undefined;
	coldStats: Array<RustcStats> | undefined;
	coldSummary: StatsSummary | undefined;
	warmStats: Array<RustcStats> | undefined;
	warmSummary: StatsSummary | undefined;
};

/** Create a source variant by appending a unique comment to the leaf crate source. */
const createWarmVariant = async (
	source: tg.Directory,
	leafPath: string,
	tag: string,
): Promise<tg.Directory> => {
	const original = await source
		.get(leafPath)
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	return tg.directory(source, {
		[leafPath]: tg.file(`${original}\n// benchmark-variant: ${tag}\n`),
	});
};

/** Shell script that wraps rustc to measure per-crate compilation duration.
 *
 * Installed as RUSTC_WRAPPER for the baseline (no proxy) scenario.
 * Emits `baseline_timing crate_name=<name> elapsed_ms=<ms>` to stderr for
 * each rustc invocation, which can be parsed from cargo-stderr.log.
 */
const timingWrapperScript = `#!/bin/sh
crate_name=""
next_is_crate=0
for arg in "$@"; do
  if [ "$next_is_crate" = "1" ]; then
    crate_name="$arg"
    next_is_crate=0
  fi
  if [ "$arg" = "--crate-name" ]; then
    next_is_crate=1
  fi
done
start_ns=$(date +%s%N)
"$@"
status=$?
end_ns=$(date +%s%N)
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [ -n "$crate_name" ]; then
  echo "baseline_timing crate_name=$crate_name elapsed_ms=$elapsed_ms" >&2
fi
exit $status
`;

/** Pre-script that installs the timing wrapper as RUSTC_WRAPPER. */
const baselineTimingPre = tg`
cat > /tmp/timing-wrapper.sh << 'TIMING_WRAPPER'
${timingWrapperScript}TIMING_WRAPPER
chmod +x /tmp/timing-wrapper.sh
export RUSTC_WRAPPER=/tmp/timing-wrapper.sh
`;

/** Parse baseline timing events from cargo-stderr.log.
 *
 * Looks for `baseline_timing crate_name=<name> elapsed_ms=<ms>` lines
 * emitted by the timing wrapper.
 */
const parseBaselineTimings = async (
	result: tg.Directory,
): Promise<Array<BaselineTiming> | undefined> => {
	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (!stderrLog) return undefined;

	const text = await stderrLog.text;
	const timings: Array<BaselineTiming> = [];

	for (const line of text.split("\n")) {
		if (!line.includes("baseline_timing")) continue;

		const crateMatch = /crate_name=(\S+)/.exec(line);
		const elapsedMatch = /elapsed_ms=(\d+)/.exec(line);

		if (crateMatch?.[1] && elapsedMatch?.[1]) {
			timings.push({
				crate_name: crateMatch[1],
				elapsed_ms: parseInt(elapsedMatch[1], 10),
			});
		}
	}

	return timings.length > 0 ? timings : undefined;
};

/** Run all benchmark scenarios for a single project. */
const runScenarios = async (
	config: BenchmarkConfig,
): Promise<BenchmarkResult> => {
	const { name, leafPath, cargoArgs = {} } = config;
	const source = await tg.resolve(config.source);

	// Warmup build to ensure vendoring, SDK, toolchain, and proxy are all cached.
	// This avoids counting one-time setup overhead in the benchmark.
	await cargo.build({
		source: await createWarmVariant(source, leafPath, "warmup"),
		...cargoArgs,
		proxy: true,
	});

	// Scenario 1: Baseline (no proxy).
	// Uses a timing wrapper as RUSTC_WRAPPER to measure per-crate rustc durations.
	// Also passes --timings to cargo for the HTML report.
	const baselineResult = await cargo.build({
		source: await createWarmVariant(source, leafPath, "baseline"),
		...cargoArgs,
		captureStderr: true,
		timings: true,
		proxy: false,
		pre: baselineTimingPre,
	});
	const baselineTimings = await parseBaselineTimings(baselineResult);
	const baselineTotalMs = baselineTimings
		? baselineTimings.reduce((sum, t) => sum + t.elapsed_ms, 0)
		: undefined;

	// Scenario 2: Proxy cold cache.
	// Use a unique variant so tgrustc has no cached crates from the warmup.
	const coldResult = await buildWithStats({
		source: await createWarmVariant(source, leafPath, "cold"),
		...cargoArgs,
	});
	const coldStats = await parseStats(coldResult);
	const coldSummary = coldStats ? summarizeStats(coldStats) : undefined;

	// Scenario 3: Proxy warm cache.
	// Different leaf source but identical dependencies. Deps should hit the tgrustc cache
	// populated by the cold build.
	const warmResult = await buildWithStats({
		source: await createWarmVariant(source, leafPath, "warm"),
		...cargoArgs,
	});
	const warmStats = await parseStats(warmResult);
	const warmSummary = warmStats ? summarizeStats(warmStats) : undefined;

	return {
		name,
		baselineTimings,
		baselineTotalMs,
		coldStats,
		coldSummary,
		warmStats,
		warmSummary,
	};
};

/** Format a summary row for the report table. */
const formatSummaryRow = (
	label: string,
	totalMs: number | undefined,
	crates: number | undefined,
	hits: number | undefined,
	misses: number | undefined,
): string => {
	if (totalMs === undefined) {
		return `  ${label.padEnd(15)}    n/a            n/a          n/a              n/a`;
	}
	const crateStr = crates !== undefined ? String(crates).padStart(4) : " n/a";
	const hitsStr = hits !== undefined ? String(hits).padStart(4) : " n/a";
	const missStr = misses !== undefined ? String(misses).padEnd(5) : "n/a  ";
	const hitRate =
		hits !== undefined && crates !== undefined && crates > 0
			? ((hits / crates) * 100).toFixed(1)
			: "n/a";
	return `  ${label.padEnd(15)}  ${String(totalMs).padStart(7)} ms    ${crateStr}      ${hitsStr} / ${missStr}    ${hitRate}${hitRate !== "n/a" ? "%" : ""}`;
};

/** Format a single benchmark result as a text report section. */
const formatResultSection = (result: BenchmarkResult): string => {
	const lines: Array<string> = [];
	const {
		name,
		baselineTimings,
		baselineTotalMs,
		coldSummary,
		warmSummary,
		warmStats,
	} = result;

	const crateCount =
		coldSummary?.crates ?? warmSummary?.crates ?? baselineTimings?.length ?? 0;
	lines.push(`--- ${name} (${crateCount} crates) ---`);
	lines.push("");
	lines.push(
		"  Scenario         Total (ms)    Crates      Hits / Misses    Hit Rate",
	);
	lines.push(
		"  --------         ----------    ------      -------------    --------",
	);

	lines.push(
		formatSummaryRow(
			"Baseline",
			baselineTotalMs,
			baselineTimings?.length,
			undefined,
			undefined,
		),
	);
	lines.push(
		formatSummaryRow(
			"Proxy Cold",
			coldSummary?.totalMs,
			coldSummary?.crates,
			coldSummary?.hits,
			coldSummary?.misses,
		),
	);
	lines.push(
		formatSummaryRow(
			"Proxy Warm",
			warmSummary?.totalMs,
			warmSummary?.crates,
			warmSummary?.hits,
			warmSummary?.misses,
		),
	);

	// Comparison section.
	const comparisons: Array<string> = [];
	if (baselineTotalMs !== undefined && coldSummary && baselineTotalMs > 0) {
		const pct =
			((coldSummary.totalMs - baselineTotalMs) / baselineTotalMs) * 100;
		comparisons.push(
			`  Cold vs Baseline:  ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
		);
	}
	if (baselineTotalMs !== undefined && warmSummary && baselineTotalMs > 0) {
		const pct =
			((warmSummary.totalMs - baselineTotalMs) / baselineTotalMs) * 100;
		comparisons.push(
			`  Warm vs Baseline:  ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
		);
	}
	if (coldSummary && warmSummary && coldSummary.totalMs > 0) {
		const pct =
			((warmSummary.totalMs - coldSummary.totalMs) / coldSummary.totalMs) * 100;
		comparisons.push(
			`  Warm vs Cold:      ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
		);
	}
	if (comparisons.length > 0) {
		lines.push("");
		lines.push(...comparisons);
	}

	// Per-crate breakdown: baseline timings.
	if (baselineTimings && baselineTimings.length > 0) {
		lines.push("");
		lines.push("  Per-crate breakdown (baseline):");
		const sorted = [...baselineTimings].sort(
			(a, b) => b.elapsed_ms - a.elapsed_ms,
		);
		for (const t of sorted) {
			lines.push(
				`    ${t.crate_name.padEnd(30)}        ${String(t.elapsed_ms).padStart(6)} ms`,
			);
		}
	}

	// Per-crate breakdown: warm cache scenario.
	if (warmStats && warmStats.length > 0) {
		lines.push("");
		lines.push("  Per-crate breakdown (warm):");
		const sorted = [...warmStats].sort((a, b) => b.elapsed_ms - a.elapsed_ms);
		for (const stat of sorted) {
			const status = stat.cached ? "HIT " : "MISS";
			lines.push(
				`    ${stat.crate_name.padEnd(30)} ${status}  ${String(stat.elapsed_ms).padStart(6)} ms`,
			);
		}
	}

	return lines.join("\n");
};

/** Format a complete benchmark report from multiple results. */
const formatReport = (results: Array<BenchmarkResult>): string => {
	const lines: Array<string> = [];
	lines.push("=== tgrustc Performance Benchmark Report ===");
	lines.push("");

	for (const result of results) {
		lines.push(formatResultSection(result));
		lines.push("");
	}

	return lines.join("\n");
};

/** Format benchmark results as JSON for programmatic consumption. */
const formatJson = (results: Array<BenchmarkResult>): string => {
	return JSON.stringify(results, null, 2);
};

// --- Individual benchmark exports ---

export const benchmarkParallelDeps = async () => {
	const result = await runScenarios({
		name: "parallel-deps",
		source: tests.get("parallel-deps").then(tg.Directory.expect),
		leafPath: "src/main.rs",
	});
	const report = formatReport([result]);
	console.log(report);
	return tg.file(report);
};

export const benchmarkVendoredPubUse = async () => {
	const result = await runScenarios({
		name: "vendored-pub-use",
		source: tests.get("vendored-pub-use").then(tg.Directory.expect),
		leafPath: "src/main.rs",
	});
	const report = formatReport([result]);
	console.log(report);
	return tg.file(report);
};

export const benchmarkHelloWorkspace = async () => {
	const result = await runScenarios({
		name: "hello-workspace",
		source: tests.get("hello-workspace").then(tg.Directory.expect),
		leafPath: "packages/cli/src/main.rs",
	});
	const report = formatReport([result]);
	console.log(report);
	return tg.file(report);
};

export const benchmarkMultiVersion = async () => {
	const result = await runScenarios({
		name: "multi-version",
		source: tests.get("multi-version").then(tg.Directory.expect),
		leafPath: "crate-b/src/main.rs",
	});
	const report = formatReport([result]);
	console.log(report);
	return tg.file(report);
};

/** Run all benchmarks and produce a combined report. */
export const benchmarkAll = async () => {
	const results = await Promise.all([
		runScenarios({
			name: "parallel-deps",
			source: tests.get("parallel-deps").then(tg.Directory.expect),
			leafPath: "src/main.rs",
		}),
		runScenarios({
			name: "vendored-pub-use",
			source: tests.get("vendored-pub-use").then(tg.Directory.expect),
			leafPath: "src/main.rs",
		}),
		runScenarios({
			name: "hello-workspace",
			source: tests.get("hello-workspace").then(tg.Directory.expect),
			leafPath: "packages/cli/src/main.rs",
		}),
		runScenarios({
			name: "multi-version",
			source: tests.get("multi-version").then(tg.Directory.expect),
			leafPath: "crate-b/src/main.rs",
		}),
	]);

	const textReport = formatReport(results);
	const jsonReport = formatJson(results);
	console.log(textReport);
	return tg.directory({
		"report.txt": tg.file(textReport),
		"report.json": tg.file(jsonReport),
	});
};
