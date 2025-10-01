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
		const args = [target, "-d"];
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

	async push(target: string): Promise<void> {
		await $`${this.exe} push ${target}`.quiet();
	}

	async cancel(processId: string, token: string): Promise<void> {
		await $`${this.exe} cancel ${processId} ${token}`.quiet();
	}

	async format(path: string): Promise<void> {
		await $`${this.exe} format ${path}`.quiet();
	}

	async check(path: string): Promise<void> {
		await $`${this.exe} check ${path}`.quiet();
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

	if (filter.include && filter.include.length > 0) {
		packages = [...filter.include];
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

	return packages.sort();
}

class Configuration {
	readonly packages: PackageFilter;
	readonly actions: string[];
	readonly parallel: boolean;
	readonly tangram: string;
	readonly currentPlatform: string;
	readonly exports: string[];
	readonly dryRun: boolean;
	readonly verbose: boolean;

	constructor(options: {
		packages?: PackageFilter;
		actions?: string[];
		parallel?: boolean;
		tangram?: string;
		exports?: string[];
		dryRun?: boolean;
		verbose?: boolean;
		platform?: string;
	}) {
		this.packages = options.packages || {};
		this.actions = options.actions || [];
		this.parallel = options.parallel ?? true;
		this.tangram = options.tangram || this.detectTangramExe();
		this.currentPlatform = options.platform || this.detectPlatform();
		this.exports = options.exports || ["default"];
		this.dryRun = options.dryRun ?? false;
		this.verbose = options.verbose ?? false;
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
		if (this.dryRun) {
			log("Dry run mode - skipping tangram validation");
			return;
		}

		const tangram = new TangramClient(this.tangram);
		await tangram.validateInstallation();
	}

	summarize(): string {
		const actions = `Actions: ${this.actions.join(", ")}`;
		const packages = `Package Filter: ${JSON.stringify(this.packages)}`;
		const exports = `Exports: ${this.exports.join(", ")}`;
		const config = `Parallel: ${this.parallel}, DryRun: ${this.dryRun}`;
		const tangram = `Tangram: ${this.tangram}`;
		const platform = `Platform: ${this.currentPlatform}`;
		return [actions, packages, exports, config, tangram, platform].join("\n");
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

  # Dry run with verbose output
  bun run scripts/package_automation.ts --dry-run --verbose -t

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
      --dry-run         Show what would be done without executing
      --verbose         Enable verbose output
      --sequential      Run packages sequentially (default: parallel)
      --platform=PLAT   Override target platform

Action Dependencies:
  Actions have implicit dependencies: check → build → test → publish → release
  Format is NOT a prerequisite and only runs when explicitly requested with -f.
  When you specify an action, all its prerequisites run automatically.
  Examples:
    -t runs: check → build → test
    -r runs: check → build → test → publish → release
    -ft runs: format → check → build → test
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
			"dry-run": { type: "boolean", default: false },
			verbose: { type: "boolean", default: false },
			sequential: { type: "boolean", default: false },
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
		parallel: !values.sequential,
		exports,
		dryRun: values["dry-run"] ?? false,
		verbose: values.verbose ?? false,
		tangram: values.tangram,
		platform: values.platform,
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
	dryRun: boolean;
	verbose: boolean;
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

		// Only track processes that have a cancellation token
		if (process.token) {
			ctx.processTracker.add(process.id, process.token);
		}

		log(
			`[${actionName}] ${buildPath}: ${processId}${options.tag ? ` (tag: ${options.tag})` : ""}`,
		);
		await ctx.tangram.processOutput(processId);
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

/** Helper to construct build tag */
function buildTag(
	packageName: string,
	version: string,
	exportName: string,
	platform: string,
): string {
	return `${packageName}/builds/${version}/${exportName}/${platform}`;
}

/** Simple result type */
type Result<T> =
	| { ok: true; value: T }
	| { ok: false; error: string; skipped?: boolean };

/** Action functions */
async function formatAction(ctx: Context): Promise<Result<void>> {
	log(`[format] ${ctx.packagePath}`);

	if (ctx.dryRun) {
		return { ok: true, value: undefined };
	}

	try {
		await ctx.tangram.format(ctx.packagePath);
		return { ok: true, value: undefined };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

async function checkAction(ctx: Context): Promise<Result<void>> {
	log(`[check] ${ctx.packagePath}`);

	if (ctx.dryRun) {
		return { ok: true, value: undefined };
	}

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

		if (ctx.dryRun) {
			built.push(buildPath);
			continue;
		}

		const result = await executeBuild(ctx, "build", buildPath);
		if (!result.ok) {
			return result as Result<string[]>;
		}
		built.push(buildPath);
	}

	return { ok: true, value: built };
}

async function publishAction(ctx: Context): Promise<Result<string>> {
	if (ctx.dryRun) {
		log("[publish] would check in and tag package (dry run)");
		return { ok: true, value: "dry run" };
	}

	// Get version from metadata
	const versionResult = await getPackageVersion(ctx);
	if (!versionResult.ok) {
		return versionResult;
	}
	const version = versionResult.value;

	const versionedName = `${ctx.packageName}/${version}`;

	// Tag the package
	log(`[publish] ${versionedName}: ${ctx.packagePath}`);
	try {
		const packageId = await ctx.tangram.checkin(ctx.packagePath);

		const existingTag = await ctx.tangram.getTag(versionedName);
		if (existingTag !== packageId) {
			await ctx.tangram.tag(versionedName, packageId);
		}

		await ctx.tangram.push(versionedName);
		return { ok: true, value: `published ${versionedName}` };
	} catch (err) {
		return { ok: false, error: extractErrorMessage(err) };
	}
}

async function releaseAction(ctx: Context): Promise<Result<string>> {
	if (ctx.dryRun) {
		log("[release] would build and upload build artifacts (dry run)");
		return { ok: true, value: "dry run" };
	}

	// Get version from metadata
	const versionResult = await getPackageVersion(ctx);
	if (!versionResult.ok) {
		return versionResult;
	}
	const version = versionResult.value;

	const versionedName = `${ctx.packageName}/${version}`;

	// Build and push each export
	const uploadedTags: string[] = [];
	for (const exportName of ctx.exports) {
		const exportSuffix = exportName !== "default" ? `#${exportName}` : "";
		const tag = buildTag(ctx.packageName, version, exportName, ctx.platform);
		const buildSource = `${versionedName}${exportSuffix}`;

		const result = await executeBuild(ctx, "release", buildSource, { tag });
		if (!result.ok) {
			return result as Result<string>;
		}

		await ctx.tangram.push(tag);
		uploadedTags.push(tag);
	}

	return { ok: true, value: `uploaded ${uploadedTags.join(", ")}` };
}

/** Results tracking */
class Results {
	private packageResults = new Map<string, boolean>();

	logSuccess(packageName: string): void {
		this.packageResults.set(packageName, true);
	}

	logFailure(packageName: string): void {
		this.packageResults.set(packageName, false);
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

		return [
			separator,
			`Successful: ${success.sort().join(" ")}`,
			`Failed: ${failed.sort().join(" ")}`,
			`Total: ${this.packageResults.size} | Passed: ${success.length} | Failed: ${failed.length}`,
		].join("\n");
	}
}

async function testAction(ctx: Context): Promise<Result<void>> {
	const buildPath = `${ctx.packagePath}#test`;

	if (ctx.dryRun) {
		return { ok: true, value: undefined };
	}

	return await executeBuild(ctx, "test", buildPath);
}

/** Ordered actions - dependencies implicit in order */
const ACTION_ORDER = ["format", "check", "build", "test", "publish", "release"];

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
		const packages = resolvePackages(this.config.packages);

		// Build list of actions to run, including prerequisites
		// Format is NOT a prerequisite - it only runs if explicitly requested
		const orderedActions: string[] = [];

		// Add format first if explicitly requested
		if (this.config.actions.includes("format")) {
			orderedActions.push("format");
		}

		// For other actions, include all prerequisites (check, build, test, publish, release)
		const nonFormatActions = this.config.actions.filter((a) => a !== "format");
		if (nonFormatActions.length > 0) {
			// Find the highest requested action (excluding format)
			const actionOrderWithoutFormat = ACTION_ORDER.filter(
				(a) => a !== "format",
			);
			const maxIndex = Math.max(
				...nonFormatActions.map((action) =>
					actionOrderWithoutFormat.indexOf(action),
				),
			);
			// Add all actions from check up to and including the highest requested
			for (const action of actionOrderWithoutFormat.slice(0, maxIndex + 1)) {
				if (!orderedActions.includes(action)) {
					orderedActions.push(action);
				}
			}
		}

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
				dryRun: this.config.dryRun,
				verbose: this.config.verbose,
			};

			let packageSuccess = true;

			for (const actionName of orderedActions) {
				const actionFn = ACTION_MAP[actionName];
				if (!actionFn) {
					log(`Unknown action: ${actionName}`);
					packageSuccess = false;
					break;
				}

				const result = await actionFn(context);

				if (!result.ok) {
					if (result.skipped) {
						log(`Skipping ${packageName}: ${result.error}`);
					} else {
						log(`Failed ${actionName} for ${packageName}: ${result.error}`);
						packageSuccess = false;
					}
					break;
				}
			}

			if (packageSuccess) {
				results.logSuccess(packageName);
			} else {
				results.logFailure(packageName);
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

	constructor(tangram: TangramClient) {
		this.tangram = tangram;
		process.on("SIGINT", async () => {
			await this.cancelAll();
			process.exit(0);
		});
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
