import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

const separator = "-".repeat(50);

const entrypoint = async () => {
  try {
    const config = ConfigParser.parseFromArgs();
    await config.validateTangram();
    log(`Starting! Configuration:\n${config.summarize()}\n${separator}`);
    const executor = new PackageExecutor(config);
    const results = await executor.run();
    log(`Done! Results:\n${results.summarize()}`);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
};

interface PackageFilter {
  include?: string[];
  exclude?: string[];
  recursive?: boolean;
}

interface BuildTarget {
  export?: string;
  platform?: string;
  tag?: string;
}

interface ActionConfig {
  name: string;
  options?: Record<string, any>;
}

class Configuration {
  readonly packages: PackageFilter;
  readonly actions: ActionConfig[];
  readonly parallel: boolean;
  readonly tangramExe: string;
  readonly currentPlatform: string;
  readonly buildTargets: BuildTarget[];
  readonly dryRun: boolean;
  readonly verbose: boolean;

  constructor(options: {
    packages?: PackageFilter;
    actions?: ActionConfig[];
    parallel?: boolean;
    tangramExe?: string;
    buildTargets?: BuildTarget[];
    dryRun?: boolean;
    verbose?: boolean;
  }) {
    this.packages = options.packages || { recursive: false };
    this.actions = options.actions || [];
    this.parallel = options.parallel ?? true;
    this.tangramExe = options.tangramExe || this.detectTangramExe();
    this.currentPlatform = this.detectPlatform();
    this.buildTargets = options.buildTargets || [{ export: "default" }];
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

    try {
      const result = await $`${this.tangramExe} --version`.text();
      if (!result.includes("tangram")) {
        throw new Error(
          `${this.tangramExe} --version produced unexpected result`,
        );
      }
    } catch (err) {
      throw new Error(`Error running ${this.tangramExe}: ${err}`);
    }
  }

  summarize(): string {
    const actions = `Actions: ${this.actions.map((a) => a.name).join(", ")}`;
    const packages = `Package Filter: ${JSON.stringify(this.packages)}`;
    const targets = `Build Targets: ${this.buildTargets
      .map(
        (t) => `${t.export || "default"}${t.platform ? `@${t.platform}` : ""}`,
      )
      .join(", ")}`;
    const config = `Parallel: ${this.parallel}, DryRun: ${this.dryRun}`;
    const tangram = `Tangram: ${this.tangramExe}`;
    const platform = `Platform: ${this.currentPlatform}`;
    return [actions, packages, targets, config, tangram, platform].join("\n");
  }
}

class ConfigParser {
  private static readonly USAGE = `Usage: bun run scripts/package_automation.ts <flags> [packages]

This script can run one or more actions on one or more packages with enhanced flexibility.

Examples:
  # Run all steps on all packages
  bun run scripts/package_automation.ts

  # Run specific actions on specific packages
  bun run scripts/package_automation.ts -cbt ripgrep jq

  # Build custom exports
  bun run scripts/package_automation.ts --build --export=custom --export=test ripgrep

  # Recursive push with custom exports
  bun run scripts/package_automation.ts --push --recursive --export=default --export=custom

  # Dry run with verbose output
  bun run scripts/package_automation.ts --dry-run --verbose -cbt

Flags:
  -b, --build           Build specified exports (default: "default")
  -c, --check           Run tg check
  -f, --format          Run tg format
  -h, --help            Print this message and exit
  -p, --publish         Create and push tags if out of date
  -t, --test            Build test export
  -u, --upload          Push builds (implies --publish and --build)
      --push            Push specific items recursively
      --export=NAME     Specify export to build/push (can be used multiple times)
      --exclude=PKG     Exclude specific packages
      --recursive       Enable recursive operations
      --dry-run         Show what would be done without executing
      --verbose         Enable verbose output
      --sequential      Run packages sequentially (default: parallel)
      --platform=PLAT   Override target platform
`;

  static parseFromArgs(): Configuration {
    const args = process.argv.slice(2);
    return this.parse(args);
  }

  static parse(args: string[]): Configuration {
    const config: {
      packages: PackageFilter;
      actions: ActionConfig[];
      parallel: boolean;
      buildTargets: BuildTarget[];
      dryRun: boolean;
      verbose: boolean;
      tangramExe?: string;
    } = {
      packages: { include: [], exclude: [], recursive: false },
      actions: [],
      parallel: true,
      buildTargets: [],
      dryRun: false,
      verbose: false,
    };

    const actionSet = new Set<string>();
    const exportSet = new Set<string>();

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--help" || arg === "-h") {
        console.log(this.USAGE);
        process.exit(0);
      } else if (arg === "--dry-run") {
        config.dryRun = true;
      } else if (arg === "--verbose") {
        config.verbose = true;
      } else if (arg === "--recursive") {
        config.packages.recursive = true;
      } else if (arg === "--sequential") {
        config.parallel = false;
      } else if (arg.startsWith("--export=")) {
        exportSet.add(arg.split("=")[1]);
      } else if (arg.startsWith("--exclude=")) {
        config.packages.exclude!.push(arg.split("=")[1]);
      } else if (arg.startsWith("--platform=")) {
        const platform = arg.split("=")[1];
        config.buildTargets.forEach((target) => (target.platform = platform));
      } else if (arg.startsWith("--tangram=")) {
        config.tangramExe = arg.split("=")[1];
      } else if (arg.startsWith("--")) {
        const action = arg.slice(2);
        if (
          [
            "build",
            "check",
            "format",
            "publish",
            "upload",
            "push",
            "test",
          ].includes(action)
        ) {
          actionSet.add(action);
        } else {
          throw new Error(`Unknown option: ${arg}\n${this.USAGE}`);
        }
      } else if (arg.startsWith("-")) {
        for (const char of arg.slice(1)) {
          switch (char) {
            case "b":
              actionSet.add("build");
              break;
            case "c":
              actionSet.add("check");
              break;
            case "f":
              actionSet.add("format");
              break;
            case "p":
              actionSet.add("publish");
              break;
            case "t":
              actionSet.add("test");
              exportSet.add("test");
              break;
            case "u":
              actionSet.add("upload");
              break;
            default:
              throw new Error(`Unknown option: -${char}\n${this.USAGE}`);
          }
        }
      } else {
        // Package name
        if (!fs.existsSync(path.join(packagesPath(), arg))) {
          throw new Error(`No such package directory: ${arg}`);
        }
        config.packages.include!.push(arg);
      }
    }

    // Set defaults
    if (actionSet.size === 0) {
      actionSet.add("check");
      actionSet.add("format");
      actionSet.add("build");
      actionSet.add("test");
      actionSet.add("upload");
      actionSet.add("publish");
    }

    if (exportSet.size === 0) {
      exportSet.add("default");
    }

    // Convert sets to arrays
    config.actions = Array.from(actionSet).map((name) => ({ name }));
    config.buildTargets = Array.from(exportSet).map((exp) => ({ export: exp }));

    // Handle special cases
    if (actionSet.has("test") && !exportSet.has("test")) {
      config.buildTargets.push({ export: "test" });
    }

    return new Configuration(config);
  }
}

/** Action registry for pluggable actions */
abstract class Action {
  abstract readonly name: string;
  abstract execute(
    context: ActionContext,
    options?: Record<string, any>,
  ): Promise<ActionResult>;

  protected log(message: string, ...args: any[]): void {
    log(`[${this.name}]`, message, ...args);
  }
}

interface ActionContext {
  packageName: string;
  packagePath: string;
  tangram: string;
  platform: string;
  buildTargets: BuildTarget[];
  processTracker: ProcessTracker;
  dryRun: boolean;
  verbose: boolean;
  recursive: boolean;
  versionedName?: string;
}

type ActionResultKind =
  | "ok"
  | "checkError"
  | "formatError"
  | "buildError"
  | "testError"
  | "tagError"
  | "pushError"
  | "uploadError"
  | "publishError"
  | "skipped";

interface ActionResult {
  kind: ActionResultKind;
  message?: string | string[];
}

class ActionRegistry {
  private actions = new Map<string, Action>();

  register(action: Action): void {
    this.actions.set(action.name, action);
  }

  get(name: string): Action | undefined {
    return this.actions.get(name);
  }

  getAll(): Action[] {
    return Array.from(this.actions.values());
  }
}

/** Built-in actions */
class FormatAction extends Action {
  readonly name = "format";

  async execute(context: ActionContext): Promise<ActionResult> {
    this.log(`formatting ${context.packagePath}`);

    if (context.dryRun) {
      return { kind: "ok", message: "would format (dry run)" };
    }

    try {
      await $`${context.tangram} format ${context.packagePath}`.quiet();
      this.log(`finished formatting ${context.packagePath}`);
      return { kind: "ok" };
    } catch (err) {
      this.log(`error formatting ${context.packagePath}`);
      return { kind: "formatError", message: err.stderr?.toString() };
    }
  }
}

class CheckAction extends Action {
  readonly name = "check";

  async execute(context: ActionContext): Promise<ActionResult> {
    this.log(`checking ${context.packagePath}`);

    if (context.dryRun) {
      return { kind: "ok", message: "would check (dry run)" };
    }

    try {
      await $`${context.tangram} check ${context.packagePath}`.quiet();
      this.log(`finished checking ${context.packagePath}`);
      return { kind: "ok" };
    } catch (err) {
      this.log(`error checking ${context.packagePath}`);
      return { kind: "checkError", message: err.stderr?.toString() };
    }
  }
}

class BuildAction extends Action {
  readonly name = "build";

  async execute(context: ActionContext): Promise<ActionResult> {
    const results: string[] = [];

    // Get the package version first
    const versionResult = await getPackageVersion(context);
    if (versionResult.kind !== "ok") {
      return versionResult;
    }
    const version = versionResult.message as string;

    for (const target of context.buildTargets) {
      const result = await this.buildTarget(context, target, version);
      if (result.kind !== "ok") {
        return result;
      }
      if (result.message) {
        results.push(result.message as string);
      }
    }

    return { kind: "ok", message: results };
  }

  private async buildTarget(
    context: ActionContext,
    target: BuildTarget,
    version: string,
  ): Promise<ActionResult> {
    const exportName = target.export || "default";
    const platform = target.platform || context.platform;
    const exportSuffix = exportName !== "default" ? `#${exportName}` : "";
    const buildTag = `${context.packageName}/builds/${version}/${exportName}/${platform}`;
    const tag = target.tag || buildTag;

    this.log(`building ${buildTag}...`);

    if (context.dryRun) {
      this.log(`would build ${buildTag} (dry run)`);
      return { kind: "ok", message: `would build ${buildTag} (dry run)` };
    }

    let processId: string | undefined;
    try {
      processId =
        await $`${context.tangram} build ${context.packageName}${exportSuffix} --tag=${tag} -d`
          .text()
          .then((t) => t.trim());

      if (processId) {
        context.processTracker.add(processId);
      }

      this.log(`${buildTag}: ${processId}`);
      await $`${context.tangram} process output ${processId}`.quiet();
      this.log(`finished building ${buildTag}`);

      // Tag the build process
      if (processId) {
        await this.tagBuildProcess(context, processId, buildTag);
      }

      return { kind: "ok", message: buildTag };
    } catch (err) {
      this.log(`error building ${buildTag}`);
      const stderr = err.stderr?.toString() || "";

      if (stderr.includes("not found in supported hosts")) {
        this.log(`${context.packageName}: unsupported host`);
        return { kind: "skipped", message: "unsupported host" };
      }

      return { kind: "buildError", message: stderr };
    } finally {
      if (processId) {
        context.processTracker.remove(processId);
      }
    }
  }

  private async tagBuildProcess(
    context: ActionContext,
    processId: string,
    buildTag: string,
  ): Promise<void> {
    if (context.dryRun) {
      this.log(`would tag build process ${processId} as ${buildTag} (dry run)`);
      return;
    }

    this.log(`tagging build process ${processId} as ${buildTag}`);

    try {
      // Check if the tag already exists and matches this process ID
      const existing = await this.getExistingBuildTag(context, buildTag);

      if (processId === existing) {
        this.log(
          `Existing tag for ${buildTag} matches current process ID:`,
          existing,
        );
        return;
      }

      await $`${context.tangram} tag ${buildTag} ${processId}`.quiet();
      this.log(`tagged build process ${buildTag}: ${processId}`);
    } catch (err) {
      this.log(`error tagging build process ${buildTag}: ${err}`);
    }
  }

  private async getExistingBuildTag(
    context: ActionContext,
    tagName: string,
  ): Promise<string> {
    this.log("checking for existing build tag", tagName);
    try {
      const result = await $`${context.tangram} tag get ${tagName}`
        .text()
        .then((t) => t.trim());
      return result;
    } catch (err) {
      return "not found";
    }
  }
}

class TestAction extends Action {
  readonly name = "test";

  async execute(context: ActionContext): Promise<ActionResult> {
    // Ensure test target is included
    const testTargets = context.buildTargets.filter((t) => t.export === "test");
    if (testTargets.length === 0) {
      testTargets.push({ export: "test" });
    }

    const buildAction = new BuildAction();
    const testContext = { ...context, buildTargets: testTargets };

    return await buildAction.execute(testContext);
  }
}

class PublishAction extends Action {
  readonly name = "publish";

  async execute(context: ActionContext): Promise<ActionResult> {
    this.log(`publishing ${context.packageName}`);

    if (context.dryRun) {
      return { kind: "ok", message: "would publish (dry run)" };
    }

    // Since tagging is now handled upfront, we just need to push the tag
    const pushResult = await this.pushTag(context);
    if (pushResult.kind !== "ok") {
      return pushResult;
    }

    const tagName = context.versionedName || context.packageName;
    return { kind: "ok", message: `published ${tagName}` };
  }

  private async pushTag(context: ActionContext): Promise<ActionResult> {
    const tagName = context.versionedName || context.packageName;
    this.log(`pushing ${tagName}`);
    try {
      await $`${context.tangram} push ${tagName}`.quiet();
      return { kind: "ok" };
    } catch (err) {
      return { kind: "pushError", message: err.stderr?.toString() };
    }
  }
}

class UploadAction extends Action {
  readonly name = "upload";

  async execute(context: ActionContext): Promise<ActionResult> {
    // First build
    const buildAction = new BuildAction();
    const buildResult = await buildAction.execute(context);

    if (
      buildResult.kind !== "ok" ||
      buildResult.message === "unsupported host"
    ) {
      return buildResult;
    }

    if (context.dryRun) {
      this.log("would upload builds (dry run)");
      return { kind: "ok", message: "would upload (dry run)" };
    }

    // Then push the builds
    const tags = Array.isArray(buildResult.message)
      ? buildResult.message
      : [buildResult.message].filter(Boolean);

    for (const tag of tags) {
      this.log(`uploading ${tag}`);
      try {
        await $`${context.tangram} push ${tag}`.quiet();
        this.log(`finished uploading ${tag}`);
      } catch (err) {
        return { kind: "pushError", message: err.stderr?.toString() };
      }
    }

    return { kind: "ok", message: `uploaded ${tags.join(", ")}` };
  }
}

class PushAction extends Action {
  readonly name = "push";

  async execute(context: ActionContext): Promise<ActionResult> {
    if (context.dryRun) {
      this.log("would push recursively (dry run)");
      return { kind: "ok", message: "would push recursively (dry run)" };
    }

    // Push each build target
    for (const target of context.buildTargets) {
      const exportName = target.export || "default";
      const item = context.recursive
        ? context.packageName
        : `${context.packageName}/${exportName}`;

      this.log(`pushing ${item} ${context.recursive ? "recursively" : ""}`);

      try {
        const cmd = context.recursive
          ? $`${context.tangram} push --recursive ${item}`
          : $`${context.tangram} push ${item}`;

        await cmd.quiet();
        this.log(`finished pushing ${item}`);
      } catch (err) {
        return { kind: "pushError", message: err.stderr?.toString() };
      }
    }

    return { kind: "ok", message: "push completed" };
  }
}

/** Enhanced results tracking */
class Results {
  private results = new Map<string, Map<string, ActionResult>>();

  log(packageName: string, actionName: string, result: ActionResult): void {
    if (!this.results.has(packageName)) {
      this.results.set(packageName, new Map());
    }
    this.results.get(packageName)!.set(actionName, result);
  }

  summarize(): string {
    const lines: string[] = [separator];
    const successPackages: string[] = [];
    const failedPackages: string[] = [];

    for (const [packageName, actions] of this.results) {
      const hasFailures = Array.from(actions.values()).some(
        (r) => r.kind !== "ok" && r.kind !== "skipped",
      );

      if (hasFailures) {
        failedPackages.push(packageName);
        lines.push(`Package: ${packageName} - FAILED`);

        for (const [actionName, result] of actions) {
          if (result.kind !== "ok" && result.kind !== "skipped") {
            lines.push(`  ${actionName}: ${result.kind}`);
            if (result.message) {
              const message = Array.isArray(result.message)
                ? result.message.join("; ")
                : result.message;
              lines.push(`    ${message}`);
            }
          }
        }
        lines.push(separator);
      } else {
        successPackages.push(packageName);
      }
    }

    lines.push(`Successful: ${successPackages.sort().join(" ")}`);
    lines.push(`Failed: ${failedPackages.sort().join(" ")}`);

    const total = this.results.size;
    const passed = successPackages.length;
    const failed = failedPackages.length;

    lines.push(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);

    return lines.join("\n");
  }
}

class PackageExecutor {
  private config: Configuration;
  private registry: ActionRegistry;
  private processTracker: ProcessTracker;

  constructor(config: Configuration) {
    this.config = config;
    this.registry = new ActionRegistry();
    this.processTracker = new ProcessTracker(config.tangramExe);
    this.registerBuiltinActions();
  }

  private registerBuiltinActions(): void {
    this.registry.register(new FormatAction());
    this.registry.register(new CheckAction());
    this.registry.register(new BuildAction());
    this.registry.register(new TestAction());
    this.registry.register(new PublishAction());
    this.registry.register(new UploadAction());
    this.registry.register(new PushAction());
  }

  async run(): Promise<Results> {
    const results = new Results();
    const packages = this.resolvePackages();

    const processPackage = async (packageName: string) => {
      const packagePath = getPackagePath(packageName);
      const context: ActionContext = {
        packageName,
        packagePath,
        tangram: this.config.tangramExe,
        platform: this.config.currentPlatform,
        buildTargets: this.config.buildTargets,
        processTracker: this.processTracker,
        dryRun: this.config.dryRun,
        verbose: this.config.verbose,
        recursive: this.config.packages.recursive || false,
      };

      log(`Processing package: ${packageName}`);

      // First, check in and tag the package (like the original script)
      const tagResult = await this.tagPackage(context);
      if (tagResult.kind !== "ok") {
        results.log(packageName, "tag", tagResult);
        return; // Stop processing this package if tagging fails
      }
      results.log(packageName, "tag", tagResult);

      for (const actionConfig of this.config.actions) {
        const action = this.registry.get(actionConfig.name);
        if (!action) {
          results.log(packageName, actionConfig.name, {
            kind: "buildError",
            message: `Unknown action: ${actionConfig.name}`,
          });
          continue;
        }

        const result = await action.execute(context, actionConfig.options);
        results.log(packageName, actionConfig.name, result);

        // Stop on first failure unless it's a skip
        if (result.kind !== "ok" && result.kind !== "skipped") {
          break;
        }
      }
    };

    if (this.config.parallel) {
      await Promise.all(packages.map(processPackage));
    } else {
      for (const pkg of packages) {
        await processPackage(pkg);
      }
    }

    // Clean up any remaining processes
    if (!this.processTracker.isEmpty()) {
      console.warn("Process tracker not clear after run!");
      await this.processTracker.cancelAll();
    }

    return results;
  }

  private resolvePackages(): string[] {
    let packages: string[] = [];

    if (
      this.config.packages.include &&
      this.config.packages.include.length > 0
    ) {
      packages = [...this.config.packages.include];
    } else {
      // Auto-discover packages
      const entries = fs.readdirSync(packagesPath(), { withFileTypes: true });
      const blacklist = new Set(["demo", "sanity", "webdemo"]);

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

    // Apply exclusions
    if (this.config.packages.exclude) {
      packages = packages.filter(
        (pkg) => !this.config.packages.exclude!.includes(pkg),
      );
    }

    return packages.sort();
  }

  /** Check in and tag a package, returning the result like the original script. */
  private async tagPackage(context: ActionContext): Promise<ActionResult> {
    log(`[tag] processing ${context.packageName}`);

    // Get the package version from metadata
    const versionResult = await getPackageVersion(context);
    if (versionResult.kind !== "ok") {
      return versionResult;
    }
    const version = versionResult.message as string;
    const versionedName = `${context.packageName}/${version}`;

    // Update context with versioned name for other actions to use
    context.versionedName = versionedName;

    if (context.dryRun) {
      log(`[tag] would check in and tag ${versionedName} (dry run)`);
      return { kind: "ok", message: "would check in and tag (dry run)" };
    }

    // Check in the package, store the ID.
    const packageIdResult = await this.checkinPackage(context);
    if (packageIdResult.kind !== "ok") {
      return packageIdResult;
    }
    const packageId = packageIdResult.message as string;
    if (!packageId) {
      return { kind: "tagError", message: `no ID for ${context.packagePath}` };
    }

    // Check if the tag already matches this ID.
    const existing = await this.getExistingTag(context, versionedName);

    if (packageId === existing) {
      log(
        `[tag] Existing tag for ${versionedName} matches current ID:`,
        existing,
      );
      return {
        kind: "ok",
        message: `${versionedName} unchanged, no action taken.`,
      };
    }

    log(`[tag] tagging ${versionedName}: ${packageId}...`);
    const tagResult = await this.tagItem(context, packageId, versionedName);
    if (tagResult.kind !== "ok") {
      return tagResult;
    }
    return {
      kind: "ok",
      message: `tagged ${versionedName}: ${packageId}`,
    };
  }

  /** Check in a package, returning the resulting ID or error. */
  private async checkinPackage(context: ActionContext): Promise<ActionResult> {
    log("[tag] checking in", context.packagePath);
    try {
      const id = await $`${context.tangram} checkin ${context.packagePath}`
        .text()
        .then((t) => t.trim());
      log(`[tag] finished checkin ${context.packagePath}`);
      return { kind: "ok", message: id };
    } catch (err) {
      log(`[tag] error checking in ${context.packagePath}: ${err}`);
      return { kind: "tagError", message: err.stdout?.toString() };
    }
  }

  /** Get the existing tagged item for a given name, if present. */
  private async getExistingTag(
    context: ActionContext,
    tagName: string,
  ): Promise<string> {
    log("[tag] checking for existing tag", tagName);
    try {
      const result = await $`${context.tangram} tag get ${tagName}`
        .text()
        .then((t) => t.trim());
      return result;
    } catch (err) {
      return "not found";
    }
  }

  /** Tag an item. */
  private async tagItem(
    context: ActionContext,
    packageId: string,
    tagName: string,
  ): Promise<ActionResult> {
    log("[tag] tagging", tagName, context.packagePath);
    try {
      await $`${context.tangram} tag ${tagName} ${context.packagePath}`.quiet();
      return { kind: "ok" };
    } catch (err) {
      return { kind: "tagError" };
    }
  }
}

/** Process tracker for build management */
class ProcessTracker {
  private ids = new Set<string>();
  private readonly tangramExe: string;

  constructor(tangramExe: string) {
    this.tangramExe = tangramExe;
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
    log("Cancelling all tracked processes...");
    for (const id of this.ids) {
      log(`cancelling ${id}`);
      try {
        await $`${this.tangramExe} cancel ${id}`.quiet();
      } catch (err) {
        log(`Failed to cancel process ${id}: ${err}`);
      }
    }
    this.ids.clear();
  }

  isEmpty(): boolean {
    return this.ids.size === 0;
  }
}

const packagesPath = () => path.join(path.dirname(import.meta.dir), "packages");

export const getPackagePath = (name: string) => path.join(packagesPath(), name);

/** Get the package version from metadata. */
async function getPackageVersion(
  context: ActionContext,
): Promise<ActionResult> {
  log("getting version from metadata for", context.packagePath);
  try {
    const metadataJson =
      await $`${context.tangram} build ${context.packagePath}#metadata`
        .text()
        .then((t) => t.trim());

    const metadata = JSON.parse(metadataJson);
    if (!metadata.version) {
      return {
        kind: "tagError",
        message: `no version found in metadata for ${context.packagePath}`,
      };
    }

    log(`found version ${metadata.version} for ${context.packagePath}`);
    return { kind: "ok", message: metadata.version };
  } catch (err) {
    log(`error getting version for ${context.packagePath}: ${err}`);
    return {
      kind: "tagError",
      message: err.stderr?.toString() || err.toString(),
    };
  }
}

const log = (...data: any[]) => {
  const timestamp = `[${new Date().toUTCString()}]`;
  console.log(timestamp, ...data);
};

if (import.meta.main) {
  entrypoint().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
