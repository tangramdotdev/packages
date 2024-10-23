import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

/** The separator bar. */
const separator = "-".repeat(50);

/** Toplevel entrypoint. */
const entrypoint = async () => {
	const options = Options.parseFromArgs();
	log(`Starting! Options:\n${options.summarize()}\n${separator}`);
	const results = await run(options);
	log(`Done! Results:\n${results.summarize()}`);
};

/** The final result for each package. */
class Results {
	private results: Map<string, Result>;
	constructor() {
		this.results = new Map();
	}
	log(name: string, result: Result) {
		this.results.set(name, result);
	}
	numPassed(): number {
		return Array.from(this.results).filter(([_, value]) => value.kind === "ok")
			.length;
	}
	numResults(): number {
		return this.results.size;
	}
	summarize(): string {
		const ret: Array<string> = [separator];
		const okNames: Array<string> = [];
		for (const [name, result] of this.results) {
			if (result.kind === "ok") {
				okNames.push(name);
				continue;
			}
			ret.push(`Name: ${name}: ${result.kind}`);
			if (result.message) {
				ret.push(`Message: ${result.message}`);
			}
			ret.push(separator);
		}
		ret.push(`Ok: ${okNames.join(" ")}`);
		const numResults = this.numResults();
		const numPassed = this.numPassed();
		const numFailed = numResults - numPassed;
		ret.push(`Total: ${numResults}\nPass: ${numPassed}\nFail: ${numFailed}`);
		return ret.join("\n");
	}
}

/** The various categories of action result. */
export type ResultKind =
	| "ok"
	| "checkError"
	| "checkinError"
	| "formatError"
	| "scriptError"
	| "testError"
	| "tagError"
	| "pushError"
	| "buildError";

/** A result with optional message. */
type Result = {
	kind: ResultKind;
	message?: string;
};

/** Construct a result. */
const result = (kind: ResultKind, message?: string): Result => {
	return {
		kind,
		message,
	};
};

/** Construct an OK. */
const ok = (message?: string): Result => {
	return {
		kind: "ok",
		message,
	};
};

/** Run the given options. */
const run = async (options: Options): Promise<Results> => {
	const results = new Results();
	const buildTracker = new BuildTracker();
	const processAndLog = async (name: string) => {
		const result = await processPackage(name, options.actions, buildTracker);
		results.log(name, result);
	};

	if (options.parallel) {
		await Promise.all(
			Array.from(options.packages).map(async (pkg) => {
				await processAndLog(pkg);
			}),
		);
	} else {
		for (const pkg of options.packages) {
			await processAndLog(pkg);
		}
	}

	// If any builds are still tracked in the build tracker, warn and try to clean up.
	if (!buildTracker.isEmpty()) {
		console.warn("Build tracker not clear after run!");
		buildTracker.cancelAll();
	}

	return results;
};

/** The usage message. */
// TODO - user-defined blacklist? --omit?
const usage = `Usage: bun run scripts/package_automation.ts <flags> [packages]

This script can run one or more actions on one or more packages.
Omit package names to run the specified steps for all discovered packages, or provide a list of names to run on a subset.
If no flags are provided, all actions will run.

Example: run all steps on all packages
bun run scripts/package_automation.ts 

Example: run just the check, build, and test steps on ripgrep and jq
bun run scripts/package_automation.ts -cbt ripgrep jq

Flags:

-b, --build: run tg build on the default target
-c, --check: run tg check
-f, --format: run tg format
-h, --help: print this message and exit
-p, --publish: if the package tag is out of date, create a new tag and push it
-t, --test: run tg build on the test target
-u, --upload: push the build for the default target. Implies --build.
--seq/--sequential: run actions sequentially for each package. If omitted, each package will process in parallel.
`;

/** Construct an Error with the usage message. */
const usageError = (message: string) => new Error(`${message}\n${usage}`);

/** Log with a timestamp. */
const log = (...data) => {
	const currentDate = `[${new Date().toUTCString()}]`;
	console.log(currentDate, ...data);
};

/** The user-defined parameters for this script invocation. */
class Options {
	/** The packages to run. If empty, all found packages will run. */
	readonly packages: Set<string>;
	/** The actions to run for each package. */
	readonly actions: Set<Action>;
	/** Whether to run each package concurrently. If false, will run in the order they are defined. */
	readonly parallel: boolean;

	constructor(...args: Array<string>) {
		let packages: Set<string> = new Set();
		let actions: Set<Action> = new Set();
		let parallel = true;

		// Helper to process an individual flag.
		const processFlag = (opt: string): void => {
			switch (opt) {
				case "b":
				case "build": {
					actions.add("build");
					break;
				}
				case "c":
				case "check": {
					actions.add("check");
					break;
				}
				case "f":
				case "format": {
					actions.add("format");
					break;
				}
				case "h":
				case "help": {
					console.log(usage);
					process.exit(0);
					break;
				}
				case "p":
				case "publish": {
					actions.add("publish");
					break;
				}
				case "seq":
				case "sequential": {
					parallel = false;
					break;
				}
				case "t":
				case "test": {
					actions.add("test");
					break;
				}
				case "u":
				case "upload": {
					actions.add("build");
					actions.add("upload");
					break;
				}
				default: {
					throw usageError(`Unknown option -${opt}`);
				}
			}
		};

		// Parse the args.
		for (const arg of args) {
			// Handle long options.
			if (arg.startsWith("--")) {
				processFlag(arg.slice(2));
			} else if (arg.startsWith("-")) {
				// Handle each character in the short option separately.
				for (const c of arg.slice(1)) {
					processFlag(c);
				}
			} else {
				// Bare words are treated as package names.
				if (!fs.existsSync(path.join(packagesPath(), arg))) {
					throw new Error(`No such package directory in repo: ${arg}`);
				}
				packages.add(arg);
			}
		}

		// If no actions were supplied, run them all.
		if (actions.size === 0) {
			actions = allActions;
		}

		// If no packages were supplied, run them all.
		if (packages.size === 0) {
			const entries = fs.readdirSync(packagesPath(), { withFileTypes: true });
			const results: Set<string> = new Set();
			const blacklist = new Set(["demo", "sanity", "webdemo"]);

			for (const entry of entries) {
				if (blacklist.has(entry.name)) {
					continue;
				}
				const fullPath = path.join(packagesPath(), entry.name);
				if (entry.isDirectory()) {
					// Check if it has a root module.
					if (fs.existsSync(path.join(fullPath, "tangram.ts"))) {
						results.add(entry.name);
					}
				}
			}
			packages = results;
		}

		this.packages = packages;
		this.actions = actions;
		this.parallel = parallel;
	}

	/** Parse the process args to instantiate the options. */
	static parseFromArgs() {
		// argv0 is bun, argv1 is the script name. Omit these and pass the remainder to the constructor.
		return new Options(...process.argv.slice(2));
	}

	/** Produce a human-readable description of the parsed options. */
	summarize(): string {
		const actions = `Actions: ${Array.from(this.actions).join(", ")}`;
		const packages = `Packages: ${Array.from(this.packages).join(", ")}`;
		const config = `Parallel: ${this.parallel}`;
		return `${actions}\n${packages}\n${config}`;
	}
}

/** The available actions:
 *
 * - build: build the default target.
 * - check: check the package.
 * - publish: check for an existing tag for this directory, tag and push if not present.
 * - test: build the test target.
 * - upload: build the default target and then push that build.
 */
type Action = "build" | "check" | "format" | "publish" | "test" | "upload";

/** Get all defined actions. */
const allActions: Set<Action> = new Set([
	"check",
	"build",
	"format",
	"test",
	"upload",
	"publish",
]);

/** Sort a set of actions into the correct execution order. */
const sortedActions = (actions: Iterable<Action>): Array<Action> => {
	const order: { [key in Action]: number } = {
		format: 0,
		check: 1,
		build: 2,
		test: 3,
		upload: 4,
		publish: 5,
	};
	return Array.from(actions).sort((a, b) => order[a] - order[b]);
};

/** Produce the path containing all the package definitions. */
const packagesPath = () => path.join(path.dirname(import.meta.dir), "packages");

/** Produce the path to a package in the packages repo by name. Assumes this script lives in <packages repo>/scripts. */
export const getPackagePath = (name: string) => path.join(packagesPath(), name);

/** Ensuring the given package test succeeds, then ensure it is tagged and pushed along with the default target build. */
const processPackage = async (
	name: string,
	actions: Set<Action>,
	buildTracker: BuildTracker,
): Promise<Result> => {
	const path = getPackagePath(name);
	log(`processing ${name}: ${path}`);

	const actionMap: Record<Action, () => Promise<Result>> = {
		format: () => formatAction(path),
		check: () => checkAction(path),
		build: () => buildDefaultTarget(path, buildTracker),
		test: () => buildTestTarget(path, buildTracker),
		upload: () => uploadAction(path, buildTracker),
		publish: () => publishAction(name, path),
	};

	for (const action of sortedActions(actions)) {
		if (action in actionMap) {
			const result = await actionMap[action]();
			if (result.kind !== "ok") {
				return result;
			}
		}
	}

	return ok("All actions completed successfully");
};

/** Perform the `format` action for a package. */
const formatAction = async (path: string): Promise<Result> => {
	log("format", path);
	try {
		await $`tg format ${path}`.quiet();
		log(`finished formatting ${path}`);
	} catch (err) {
		log(`error formatting ${path}`);
		return result("formatError", err.stderr.toString());
	}
	return ok();
};

/** Perform the `check` action for a package. */
const checkAction = async (path: string): Promise<Result> => {
	log("checking", path);
	try {
		await $`tg check ${path}`.quiet();
		log(`finished checking ${path}`);
	} catch (err) {
		log(`error checking ${path}`);
		return result("checkError", err.stderr.toString());
	}
	return ok();
};

/** Perform the `publish` action for a package name. If the existing tag is out of date, tag and push the new package. */
const publishAction = async (name: string, path: string): Promise<Result> => {
	log("publishing...");
	// Check in the package, store the ID.
	const packageIdResult = await checkinPackage(path);
	if (packageIdResult.kind !== "ok") {
		return packageIdResult;
	}
	const packageId = packageIdResult.message;
	if (packageId === undefined) {
		return result("checkinError", `no ID for ${path}`);
	}

	// Look up the existing tag for the given name.
	const existingTag = await existingTaggedItem(name);

	// If there is no tag or the ID does not match, tag the package.
	if (packageId !== existingTag) {
		log(`tagging ${name}...`);
		const tagResult = await tagPackage(name, path);
		if (tagResult.kind !== "ok") {
			return tagResult;
		}

		// Push the tag.
		const pushTagResult = await push(name);
		if (pushTagResult.kind !== "ok") {
			return pushTagResult;
		}
	} else {
		return ok(`matching tag found for ${name}: ${packageId}, not re-tagging.`);
	}
	return ok(`tagged ${name}: ${packageId}`);
};

/** Perform the upload action for a path. Will do the default build first. */
const uploadAction = async (
	path: string,
	buildTracker: BuildTracker,
): Promise<Result> => {
	const buildIdResult = await buildDefaultTarget(path, buildTracker);
	if (buildIdResult.kind !== "ok") {
		return buildIdResult;
	}
	const buildId = buildIdResult.message;
	if (buildId === undefined) {
		return result("buildError", `no ID for ${path}`);
	}

	log(`uploading build ${buildId}`);
	try {
		await $`tg push ${buildId}`.quiet();
		log(`finished pushing ${buildId}`);
		return ok();
	} catch (err) {
		log(`error pushing ${buildId}`);
		return result("pushError", err.stderr.toString());
	}
};

/** Check in a path, returning the resulting ID or "checkinError" on failure. */
const checkinPackage = async (path: string): Promise<Result> => {
	log("checking in", path);
	try {
		const id = await $`tg checkin ${path}`.text().then((t) => t.trim());
		log(`finished checkin ${path}`);
		return ok(id);
	} catch (err) {
		log(`error checking in ${path}`);
		return result("checkinError", err.stdout.toString());
	}
};

/** Get the existing tagged item for a given name, if present. */
const existingTaggedItem = async (name: string): Promise<string> => {
	log("checking for existing tag", name);
	try {
		const result = await $`tg tag get ${name}`.text().then((t) => t.trim());
		return result;
	} catch (err) {
		return "not found";
	}
};

/** Tag a package at the given path with the given name. */
const tagPackage = async (name: string, path: string): Promise<Result> => {
	log("tagging", name, path);
	try {
		await $`tg tag ${name} ${path}`.quiet();
		return ok();
	} catch (err) {
		return result("tagError");
	}
};

/** Push something. */
const push = async (arg: string): Promise<Result> => {
	log("pushing", arg);
	try {
		await $`tg push ${arg}`.quiet();
		log(`finished pushing ${arg}`);
	} catch (err) {
		log(`error pushing ${arg}`);
		return result("pushError", err.stderr.toString());
	}
	return ok();
};

/** Build the default target given a path. Return the build ID. */
const buildDefaultTarget = async (
	path: string,
	buildTracker: BuildTracker,
): Promise<Result> => {
	log(`building ${path}`);
	try {
		const buildId = await $`tg build ${path} -d`.text().then((t) => t.trim());
		buildTracker.add(buildId);
		log(`${path}: ${buildId}`);
		await $`tg build output ${buildId}`.quiet();
		buildTracker.remove(buildId);
		log(`finished building ${path}`);
		return ok(buildId);
	} catch (err) {
		log(`error building ${path}`);
		return result("buildError", err.stderr.toString());
	}
};

/** Build the default target given a path. Return the build ID. */
const buildTestTarget = async (
	path: string,
	buildTracker: BuildTracker,
): Promise<Result> => {
	log(`building ${path}#test...`);
	try {
		const buildId = await $`tg build ${path}#test -d`
			.text()
			.then((t) => t.trim());
		buildTracker.add(buildId);
		log(`${path}#test: ${buildId}`);
		await $`tg build output ${buildId}`.quiet();
		buildTracker.remove(buildId);
		log(`finished building ${path}#test`);
		return ok(buildId);
	} catch (err) {
		log(`error building ${path}#test`);
		return result("testError", err.stderr.toString());
	}
};

/** Class for managing builds created by this script. */
class BuildTracker {
	private ids: Set<string>;
	constructor() {
		this.ids = new Set();
		process.on("SIGINT", async () => {
			await this.cancelAll();
			process.exit(0);
		});
	}
	add(id: string): void {
		this.ids.add(id);
	}
	remove(id: string): void {
		this.ids.delete(id);
	}
	async cancelAll(): Promise<void> {
		log("Cancelling all created builds...");
		for (const id of this.ids) {
			log(`cancelling ${id}`);
			try {
				await $`tg build cancel ${id}`.quiet();
			} catch (err) {
				log(`Failed to cancel build ${id}: ${err}`);
			}
		}
		this.ids.clear();
	}
	isEmpty(): boolean {
		return this.ids.size === 0;
	}
}

await entrypoint();
