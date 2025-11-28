import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";

const separator = "-".repeat(50);

/** Unified logging */
const log = (...data: unknown[]) => {
	const timestamp = `[${new Date().toUTCString()}]`;
	console.log(timestamp, ...data);
};

/** Extract error message from various error types */
const extractErrorMessage = (err: unknown): string => {
	if (err && typeof err === "object") {
		const e = err as { stderr?: { toString(): string }; message?: string };
		return e.stderr?.toString() || e.message || String(err);
	}
	return String(err);
};

/** Check if error indicates unsupported host */
const isUnsupportedHostError = (err: unknown): boolean => {
	const message = extractErrorMessage(err);
	return message.includes("not found in supported hosts");
};

/** Tangram CLI client for all tangram operations */
class TangramClient {
	constructor(private readonly exe: string) {}

	async validateInstallation(): Promise<void> {
		try {
			const result = await $`${this.exe} --version`.text();
			if (!result.includes("tangram")) {
				throw new Error(`${this.exe} --version produced unexpected result`);
			}
		} catch (err) {
			throw new Error(`Error running ${this.exe}: ${err}`);
		}
	}

	async checkin(path: string): Promise<string> {
		const id = await $`${this.exe} checkin ${path}`
			.text()
			.then((t) => t.trim());
		return id;
	}

	async tag(name: string, target: string): Promise<void> {
		await $`${this.exe} tag ${name} ${target}`.quiet();
	}

	async getTag(name: string): Promise<string | null> {
		try {
			const result = await $`${this.exe} tag get ${name}`
				.text()
				.then((t) => t.trim());
			return result;
		} catch (_err) {
			return null;
		}
	}

	async build(
		target: string,
		options: { tag?: string } = {},
	): Promise<{ id: string; token?: string }> {
		const args = [target, "--retry", "-d"];
		if (options.tag) {
			args.push(`--tag=${options.tag}`);
		}

		const output = await $`${this.exe} build ${args}`
			.text()
			.then((t) => t.trim());

		const result = JSON.parse(output);
		const returnValue: { id: string; token?: string } = { id: result.process };
		if (result.token) {
			returnValue.token = result.token;
		}
		return returnValue;
	}

	async processOutput(processId: string): Promise<string> {
		return await $`${this.exe} process output ${processId}`
			.text()
			.then((t) => t.trim());
	}

	async push(target: string, options: { lazy?: boolean } = {}): Promise<void> {
		const args = [target];
		if (options.lazy ?? true) {
			args.push("--lazy");
		}
		await $`${this.exe} push ${args}`.quiet();
	}

	async cancel(processId: string, token: string): Promise<void> {
		await $`${this.exe} cancel ${processId} ${token}`.quiet();
	}

	async format(path: string): Promise<void> {
		await $`${this.exe} format ${path}`;
	}

	async check(path: string): Promise<void> {
		await $`${this.exe} check ${path}`;
	}

	async publish(path: string): Promise<void> {
		await $`${this.exe} publish ${path}`;
	}
}

const entrypoint = async () => {
	try {
		const config = parseFromArgs();
		await config.validateTangram();
		log(`Starting! Configuration:\n${config.summarize()}\n${separator}`);
		const executor = new PackageExecutor(config);
		const results = await executor.run();
		log(`Done! Results:\n${results.summarize()}`);

		if (results.hasFailures()) {
			process.exit(1);
		}
	} catch (error) {
		log("Error:", error.message);
		process.exit(1);
	}
};

interface PackageFilter {
	include?: string[];
	exclude?: string[];
}

/** Resolves which packages to process from the filesystem */
function resolvePackages(filter: PackageFilter): string[] {
	const blacklist = new Set(["demo", "sanity", "webdemo"]);
	let packages: string[] = [];
	let wasExplicitlyIncluded = false;

	if (filter.include && filter.include.length > 0) {
		packages = [...filter.include];
		wasExplicitlyIncluded = true;
	} else {
		const entries = fs.readdirSync(packagesPath(), { withFileTypes: true });

		for (const entry of entries) {
			if (blacklist.has(entry.name)) continue;

			const fullPath = path.join(packagesPath(), entry.name);
			if (
				entry.isDirectory() &&
				fs.existsSync(path.join(fullPath, "tangram.ts"))
			) {
				packages.push(entry.name);
			}
		}
	}

	if (filter.exclude) {
		packages = packages.filter((pkg) => !filter.exclude?.includes(pkg));
	}

	// Only sort if packages were discovered from the filesystem
	// Preserve order if explicitly included via command-line arguments
	if (!wasExplicitlyIncluded) {
		packages.sort();
	}

	// Always move std to the front if it exists in the list
	const stdIndex = packages.indexOf("std");
	if (stdIndex > 0) {
		packages.splice(stdIndex, 1);
		packages.unshift("std");
	}

	return packages;
}

class Configuration {
	readonly packages: PackageFilter;
	readonly actions: string[];
	readonly parallel: boolean;
	readonly tangram: string;
	readonly currentPlatform: string;
	readonly exports: string[];
	readonly verbose: boolean;
	readonly lazy: boolean;

	constructor(options: {
		packages?: PackageFilter;
		actions?: string[];
		parallel?: boolean;
		tangram?: string;
		exports?: string[];
		verbose?: boolean;
		platform?: string;
		lazy?: boolean;
	}) {
		this.packages = options.packages || {};
		this.actions = options.actions || [];
		this.parallel = options.parallel ?? false;
		this.tangram = options.tangram || this.detectTangramExe();
		this.currentPlatform = options.platform || this.detectPlatform();
		this.exports = options.exports || ["default"];
		this.verbose = options.verbose ?? false;
		this.lazy = options.lazy ?? true;
	}

	private detectTangramExe(): string {
		return Bun.env.TG_EXE || "tangram";
	}

	private detectPlatform(): string {
		const detectedArch = process.arch;
		let tangramArch: string;
		if (detectedArch === "x64") {
			tangramArch = "x86_64";
		} else if (detectedArch === "arm64") {
			tangramArch = "aarch64";
		} else {
			throw new Error(`unsupported host arch: ${detectedArch}`);
		}

		const os = process.platform;
		if (os !== "linux" && os !== "darwin") {
			throw new Error(`unsupported host os: ${os}`);
		}

		return `${tangramArch}-${os}`;
	}

	async validateTangram(): Promise<void> {
		const tangram = new TangramClient(this.tangram);
		await tangram.validateInstallation();
	}

	summarize(): string {
		const actions = `Actions: ${this.actions.join(", ")}`;
		const packages = `Package Filter: ${JSON.stringify(this.packages)}`;
		const exports = `Exports: ${this.exports.join(", ")}`;
		const config = `Parallel: ${this.parallel}`;
		const tangram = `Tangram: ${this.tangram}`;
		const platform = `Platform: ${this.currentPlatform}`;
		const lazy = `Lazy Push: ${this.lazy}`;
		return [actions, packages, exports, config, tangram, platform, lazy].join(
			"\n",
		);
	}
}

const USAGE = `Usage: bun run scripts/package_automation.ts <flags> [packages]

This script can run one or more actions on one or more packages with enhanced flexibility.

Examples:
  # Run all check, build, and test on all packages
  bun run scripts/package_automation.ts

  # Run specific actions on specific packages
  bun run scripts/package_automation.ts -r ripgrep jq

  # Format and test (format must be explicitly requested)
  bun run scripts/package_automation.ts -ft ripgrep

  # Build custom exports
  bun run scripts/package_automation.ts --build --export=custom --export=test ripgrep

Flags:
  -b, --build           Build specified exports (default: "default")
  -c, --check           Run tg check
  -f, --format          Run tg format (only runs when explicitly specified)
  -h, --help            Print this message and exit
  -p, --publish         Tag and push package directory
  -r, --release         Upload build artifacts
  -t, --test            Build test export
      --export=NAME     Specify export to build (can be used multiple times)
      --exclude=PKG     Exclude specific packages
      --verbose         Enable verbose output
      --parallel        Run packages in parallel (default: sequential)
      --platform=PLAT   Override target platform
      --eager           Disable lazy push (lazy push is enabled by default)

Action Dependencies:
  Actions have the following dependencies:
    - build depends on: check
    - test depends on: build (transitively includes check)
    - publish has no dependencies (runs standalone)
    - release depends on: test, publish (transitively includes check, build)
  Format is NOT a prerequisite and only runs when explicitly requested with -f.
  When you specify an action, all its prerequisites run automatically.
  Examples:
    -p runs: publish (only)
    -tp runs: check → build → test → publish
    -r runs: check → build → test → publish → release
`;

function parseFromArgs(): Configuration {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			help: { type: "boolean", short: "h", default: false },
			build: { type: "boolean", short: "b", default: false },
			check: { type: "boolean", short: "c", default: false },
			format: { type: "boolean", short: "f", default: false },
			publish: { type: "boolean", short: "p", default: false },
			release: { type: "boolean", short: "r", default: false },
			test: { type: "boolean", short: "t", default: false },
			verbose: { type: "boolean", default: false },
			parallel: { type: "boolean", default: false },
			eager: { type: "boolean", default: false },
			export: { type: "string", multiple: true },
			exclude: { type: "string", multiple: true },
			platform: { type: "string" },
			tangram: { type: "string" },
		},
		strict: true,
		allowPositionals: true,
	});

	if (values.help) {
		console.log(USAGE);
		process.exit(0);
	}

	const actions: string[] = [];

	// Process action flags - order matters for execution
	if (values.format) actions.push("format");
	if (values.check) actions.push("check");
	if (values.build) actions.push("build");
	if (values.test) actions.push("test");
	if (values.publish) actions.push("publish");
	if (values.release) actions.push("release");

	// Default actions if none specified
	if (actions.length === 0) {
		actions.push("test");
	}

	// Process export flags - multiple: true ensures it's always an array or undefined
	const exportList = values.export || [];
	const exports = exportList.length > 0 ? exportList : ["default"];

	// Process positional arguments (package names)
	const includePackages = positionals.filter((pkg) => {
		if (!fs.existsSync(path.join(packagesPath(), pkg))) {
			throw new Error(`No such package directory: ${pkg}`);
		}
		return true;
	});

	return new Configuration({
		packages: {
			include: includePackages.length > 0 ? includePackages : undefined,
			exclude: values.exclude,
		},
		actions,
		parallel: values.parallel ?? false,
		exports,
		verbose: values.verbose ?? false,
		tangram: values.tangram,
		platform: values.platform,
		lazy: !values.eager,
	});
}

/** Execution context for actions */
interface Context {
	packageName: string;
	packagePath: string;
	tangram: TangramClient;
	platform: string;
	exports: string[];
	processTracker: ProcessTracker;
	verbose: boolean;
	lazy: boolean;
}

/** Helper to get version from package metadata */
async function getPackageVersion(ctx: Context): Promise<Result<string>> {
	try {
		const process = await ctx.tangram.build(`${ctx.packagePath}#metadata`);
		const metadataJson = await ctx.tangram.processOutput(process.id);
		const metadata = JSON.parse(metadataJson);
		if (!metadata.version) {
			throw new Error(`no version found in metadata for ${ctx.packagePath}`);
		}
		return { ok: true, value: metadata.version };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

/** Helper to manage build process with tracking */
async function executeBuild(
	ctx: Context,
	actionName: string,
	buildPath: string,
	options: { tag?: string } = {},
): Promise<Result<void>> {
	let processId: string | undefined;
	try {
		const process = await ctx.tangram.build(buildPath, options);
		processId = process.id;

		// Only track and wait for processes that have a cancellation token
		if (process.token) {
			ctx.processTracker.add(process.id, process.token);
			log(
				`[${actionName}] ${buildPath}: ${processId}${options.tag ? ` (tag: ${options.tag})` : ""}`,
			);
			await ctx.tangram.processOutput(processId);
		} else {
			// No token means the build is cached/already complete
			log(
				`[${actionName}] ${buildPath}: ${processId} (cached)${options.tag ? ` (tag: ${options.tag})` : ""}`,
			);
		}

		return { ok: true, value: undefined };
	} catch (err) {
		if (isUnsupportedHostError(err)) {
			return { ok: false, error: "unsupported host", skipped: true };
		}
		return { ok: false, error: extractErrorMessage(err) };
	} finally {
		if (processId) {
			ctx.processTracker.remove(processId);
		}
	}
}

/** Export configuration for release action */
type ExportConfig = {
	ref: string; // Export name ("default", "build") or path ("sdk.tg.ts#sdk")
	tagPath: string; // Tag path segment (e.g., "sdk" → "pkg/builds/1.0.0/sdk/platform")
	args?: Record<string, unknown>; // Optional build arguments
};

type ExportMatrix = ExportConfig[];

/** Package-specific export matrices for release action */
const PACKAGE_EXPORT_MATRICES: Record<string, ExportMatrix> = {
	std: [
		{ ref: "default", tagPath: "default" },
		{ ref: "default_", tagPath: "default_" },
		{ ref: "sdk.tg.ts#sdk", tagPath: "sdk" },
		{ ref: "utils.tg.ts#defaultEnv", tagPath: "utils/env" },
		{ ref: "utils/coreutils.tg.ts#gnuEnv", tagPath: "utils/gnuEnv" },
		{ ref: "wrap/injection.tg.ts#injection", tagPath: "wrap/injection" },
		{ ref: "wrap/workspace.tg.ts#workspace", tagPath: "wrap/workspace" },
		{
			ref: "wrap/workspace.tg.ts#defaultWrapper",
			tagPath: "wrap/defaultWrapper",
		},
		{
			ref: "sdk/dependencies.tg.ts#extendedBuildTools",
			tagPath: "dependencies/buildTools/extended",
		},
	],
};

/** Default export matrix for packages without custom configuration */
const DEFAULT_EXPORT_MATRIX: ExportMatrix = [
	{ ref: "default", tagPath: "default" },
	{ ref: "build", tagPath: "build" },
];

/** Get export matrix for a package */
function getExportMatrix(packageName: string): ExportMatrix {
	return PACKAGE_EXPORT_MATRICES[packageName] || DEFAULT_EXPORT_MATRIX;
}

/** Simple result type */
type Result<T> =
	| { ok: true; value: T }
	| { ok: false; error: string; skipped?: boolean };

/** Action functions */
async function formatAction(ctx: Context): Promise<Result<void>> {
	log(`[format] ${ctx.packagePath}`);

	try {
		await ctx.tangram.format(ctx.packagePath);
		return { ok: true, value: undefined };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

async function checkAction(ctx: Context): Promise<Result<void>> {
	log(`[check] ${ctx.packagePath}`);

	try {
		await ctx.tangram.check(ctx.packagePath);
		return { ok: true, value: undefined };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

async function buildAction(ctx: Context): Promise<Result<string[]>> {
	const built: string[] = [];

	for (const exportName of ctx.exports) {
		const exportSuffix = exportName !== "default" ? `#${exportName}` : "";
		const buildPath = `${ctx.packagePath}${exportSuffix}`;

		const result = await executeBuild(ctx, "build", buildPath);
		if (!result.ok) {
			return result as Result<string[]>;
		}
		built.push(buildPath);
	}

	return { ok: true, value: built };
}

async function publishAction(ctx: Context): Promise<Result<string>> {
	// Get version from metadata
	const versionResult = await getPackageVersion(ctx);
	if (!versionResult.ok) {
		return versionResult;
	}
	const version = versionResult.value;

	const versionedName = `${ctx.packageName}/${version}`;

	// Publish the package
	log(`[publish] ${versionedName}: ${ctx.packagePath}`);
	try {
		await ctx.tangram.publish(ctx.packagePath);
		return { ok: true, value: `published ${versionedName}` };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

async function releaseAction(ctx: Context): Promise<Result<string>> {
	// Get version from metadata
	const versionResult = await getPackageVersion(ctx);
	if (!versionResult.ok) {
		return versionResult;
	}
	const version = versionResult.value;

	const versionedName = `${ctx.packageName}/${version}`;
	const uploadedTags: string[] = [];
	const pushErrors: string[] = [];
	const exportMatrix = getExportMatrix(ctx.packageName);

	for (const [index, exportConfig] of exportMatrix.entries()) {
		const { ref, tagPath } = exportConfig;

		// Determine build source based on ref type
		// If ref contains "/" or ".tg.ts", treat it as a path; otherwise, as an export name
		const isPath = ref.includes("/") || ref.includes(".tg.ts");
		let buildSource: string;

		if (isPath) {
			// Path-based ref: build from local package path
			buildSource = `${ctx.packagePath}/${ref}`;
		} else {
			// Export name: build from versioned package
			const exportSuffix = ref !== "default" ? `#${ref}` : "";
			buildSource = `${versionedName}${exportSuffix}`;
		}

		// Construct tag
		const tag = `${ctx.packageName}/builds/${version}/${tagPath}/${ctx.platform}`;

		// Build with tag
		const result = await executeBuild(ctx, "release", buildSource, { tag });
		if (!result.ok) {
			// Fail for the first export, skip subsequent exports
			if (index === 0) {
				return result as Result<string>;
			}
			log(`[release] Skipping ${ref}: ${result.error}`);
			continue;
		}

		// Push the build
		log(`[release] Pushing ${tag}${ctx.lazy ? " (lazy)" : ""}`);
		try {
			await ctx.tangram.push(tag, { lazy: ctx.lazy });
			log(`[release] Pushed ${tag}`);
			uploadedTags.push(tag);
		} catch (err) {
			const errorMessage = extractErrorMessage(err);
			log(`[release] Failed to push ${tag}: ${errorMessage}`);
			pushErrors.push(`${tag}: ${errorMessage}`);
		}
	}

	// If any pushes failed, return an error
	if (pushErrors.length > 0) {
		return { ok: false, error: pushErrors.join("; ") };
	}

	return { ok: true, value: `uploaded ${uploadedTags.join(", ")}` };
}

/** Results tracking */
class Results {
	private packageResults = new Map<string, boolean>();
	private packageErrors = new Map<
		string,
		Array<{ action: string; error: string }>
	>();

	logSuccess(packageName: string): void {
		this.packageResults.set(packageName, true);
	}

	logFailure(packageName: string, action: string, error: string): void {
		this.packageResults.set(packageName, false);

		if (!this.packageErrors.has(packageName)) {
			this.packageErrors.set(packageName, []);
		}
		this.packageErrors.get(packageName)?.push({ action, error });
	}

	hasFailures(): boolean {
		return Array.from(this.packageResults.values()).some((v) => !v);
	}

	summarize(): string {
		const success: string[] = [];
		const failed: string[] = [];

		for (const [name, passed] of this.packageResults) {
			if (passed) {
				success.push(name);
			} else {
				failed.push(name);
			}
		}

		const lines = [separator];

		if (failed.length > 0) {
			lines.push("", separator, "ERRORS:", separator);

			for (const packageName of failed.sort()) {
				const errors = this.packageErrors.get(packageName) || [];
				lines.push("", `Package: ${packageName}`);
				for (const { action, error } of errors) {
					lines.push(`  Action: ${action}`);
					lines.push(
						`  Error: ${error
							.split("\n")
							.map((line, i) => (i === 0 ? line : `         ${line}`))
							.join("\n")}`,
					);
				}
			}

			lines.push("", separator);
		}

		lines.push(
			`Successful: ${success.sort().join(" ")}`,
			`Failed: ${failed.sort().join(" ")}`,
			`Total: ${this.packageResults.size} | Passed: ${success.length} | Failed: ${failed.length}`,
		);

		return lines.join("\n");
	}
}

async function testAction(ctx: Context): Promise<Result<void>> {
	const buildPath = `${ctx.packagePath}#test`;

	return await executeBuild(ctx, "test", buildPath);
}

/** Ordered actions - dependencies implicit in order */
const ACTION_ORDER = ["format", "check", "build", "test", "publish", "release"];

/** Action dependencies - each action lists its direct prerequisites */
const ACTION_DEPENDENCIES: Record<string, string[]> = {
	format: [],
	check: [],
	build: ["check"],
	test: ["build"],
	publish: [],
	release: ["build", "publish"],
};

type ActionFunction = (ctx: Context) => Promise<Result<unknown>>;

const ACTION_MAP: Record<string, ActionFunction> = {
	format: formatAction,
	check: checkAction,
	build: buildAction,
	test: testAction,
	publish: publishAction,
	release: releaseAction,
};

class PackageExecutor {
	private config: Configuration;
	private processTracker: ProcessTracker;
	private tangram: TangramClient;

	constructor(config: Configuration) {
		this.config = config;
		this.tangram = new TangramClient(config.tangram);
		this.processTracker = new ProcessTracker(this.tangram);
	}

	async run(): Promise<Results> {
		const results = new Results();
		this.processTracker.setResults(results);
		const packages = resolvePackages(this.config.packages);

		// Build set of actions to run, including all dependencies (transitively)
		const actionsToRun = new Set<string>();

		const addActionWithDeps = (action: string) => {
			if (actionsToRun.has(action)) return;
			actionsToRun.add(action);
			const deps = ACTION_DEPENDENCIES[action] || [];
			for (const dep of deps) {
				addActionWithDeps(dep);
			}
		};

		for (const action of this.config.actions) {
			addActionWithDeps(action);
		}

		// Order actions according to ACTION_ORDER
		const orderedActions = ACTION_ORDER.filter((action) =>
			actionsToRun.has(action),
		);

		const processPackage = async (packageName: string) => {
			const packagePath = getPackagePath(packageName);

			log(`Processing package: ${packageName}`);

			const context: Context = {
				packageName,
				packagePath,
				tangram: this.tangram,
				platform: this.config.currentPlatform,
				exports: this.config.exports,
				processTracker: this.processTracker,
				verbose: this.config.verbose,
				lazy: this.config.lazy,
			};

			let packageSuccess = true;

			for (const actionName of orderedActions) {
				const actionFn = ACTION_MAP[actionName];
				if (!actionFn) {
					log(`Unknown action: ${actionName}`);
					results.logFailure(packageName, actionName, "Unknown action");
					packageSuccess = false;
					break;
				}

				const result = await actionFn(context);

				if (!result.ok) {
					if (result.skipped) {
						log(`Skipping ${packageName}: ${result.error}`);
					} else {
						log(`Failed ${actionName} for ${packageName}`);
						results.logFailure(packageName, actionName, result.error);
						packageSuccess = false;
					}
					break;
				}
			}

			if (packageSuccess) {
				results.logSuccess(packageName);
			}
		};

		if (this.config.parallel) {
			await Promise.all(packages.map(processPackage));
		} else {
			for (const pkg of packages) {
				await processPackage(pkg);
			}
		}

		if (!this.processTracker.isEmpty()) {
			log("Process tracker not clear after run!");
			await this.processTracker.cancelAll();
		}

		return results;
	}
}

/** Process tracker for build management */
class ProcessTracker {
	private processes = new Map<string, string>();
	private readonly tangram: TangramClient;
	private results?: Results;

	constructor(tangram: TangramClient) {
		this.tangram = tangram;
		process.on("SIGINT", async () => {
			log("\nInterrupted! Cancelling processes...\n");
			await this.cancelAll();
			if (this.results) {
				log(`\n${this.results.summarize()}`);
			}
			process.exit(1);
		});
	}

	setResults(results: Results): void {
		this.results = results;
	}

	add(id: string, token: string): void {
		this.processes.set(id, token);
	}

	remove(id: string): void {
		this.processes.delete(id);
	}

	async cancelAll(): Promise<void> {
		log("Cancelling all tracked processes...");
		for (const [id, token] of this.processes) {
			log(`cancelling ${id}`);
			try {
				await this.tangram.cancel(id, token);
			} catch (err) {
				log(`Failed to cancel process ${id}: ${err}`);
			}
		}
		this.processes.clear();
	}

	isEmpty(): boolean {
		return this.processes.size === 0;
	}
}

const packagesPath = () => path.join(path.dirname(import.meta.dir), "packages");

export const getPackagePath = (name: string) => path.join(packagesPath(), name);

if (import.meta.main) {
	entrypoint().catch((error) => {
		log("Fatal error:", error);
		process.exit(1);
	});
}
