import * as m4 from "m4" with { path: "../m4" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pkgConfig from "pkg-config" with { path: "../pkg-config" };
import * as readline from "readline" with { path: "../readline" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.47.2",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f1b2ee412c28d7472bc95ba996368d6f0cdcf00362affdadb27ed286c179540b";
	const extension = ".tar.gz";

	const produceVersion = (version: string) => {
		const [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, "0")}${patch.padEnd(3, "0")}`;
	};

	const packageName = `${name}-autoconf-${produceVersion(version)}`;
	const base = `https://www.sqlite.org/2024`;
	return std
		.download({ checksum, base, packageName, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	// Each dependency with args that aren't build or host that the user should have exposed go here.
	dependencies?: {
		pkgConfig?: DependencyArg<pkgConfig.Arg>;
		// Mandatory dependencies use this type.
		ncurses?: DependencyArg<ncurses.Arg>;
		// Optional dependencies can also take a boolean to disable including in the build env. Maybe `OptionalDependencyArg<T>`?
		readline?: boolean | DependencyArg<readline.Arg>;
		zlib?: DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	// Any configure flag that the user should decide should have a corresponding arg.
	someOptionalFeature?: boolean;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	// Combine args
	const {
		autotools = {},
		build,
		dependencies: {
			pkgConfig: pkgConfigArg = {},
			ncurses: ncursesArg = {},
			readline: readlineArg = false, // if it is included by default, set this to {} instead.
			zlib: zlibArg = {},
		} = {},
		env: envArg,
		host,
		sdk,
		source: sourceArg,
		someOptionalFeature = true,
	} = await std.args.apply<Arg>(...args);

	// Set up dependencies.
	const dependencies = [
		buildDependency(pkgConfig.default_, pkgConfigArg),
		buildDependency(m4.default_), // args are optional - we didn't expose any to the user, so omit them.
		// OR
		m4.default_, // if we don't care about build-dependency specific settings and have no args, just pass the command itself.
		// OR
		dependency(ncurses.default_, ncursesArg), // If we don't care about build vs runtime, just want the defaults
		// OR - the above is sugar for this object with two keys
		{
			buildCmd: ncurses.default_,
			arg: ncursesArg,
		},
		runtimeDependency(ncurses.default_, ncursesArg),
		runtimeDependency(zlib.default_, zlibArg),
		// OR tweak a field
		{
			...runtimeDependency(zlib.default_, zlibArg),
			subdirs: ["bin", "include", "lib", "libexec"],
		},
		// OR specify the whole thing
		{
			buildCmd: zlib.default_,
			arg: zlibArg,
			subdirs: ["lib"],
			inheritEnv: true,
			inheritSdk: true,
		},
	];

	// You can also choose not to use this utility and just add the directory `zlib.default({ build, env, host, sdk }, zlibArg)` to the env yourself.

	// Because nothing is awaited, nothing happens in the false case.
	if (readlineArg) {
		const readlineArg_ = typeof readlineArg === "boolean" ? {} : readlineArg;
		dependencies.push(runtimeDependency(readline.default_, readlineArg_));
	}

	// Combine the dependencies with any other env that needs setting.
	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		...dependencies.map((dep) =>
			stdMakeDependencyEnvArg(build, envArg, host, sdk, dep),
		),
		{ SOME: "other env" },
		tg.directory({ bin: { foo: tg.file("demo", { executable: true }) } }),
	];

	// Construct the final env by combining all our defined envs with the user env arg last.
	const env = std.env.arg(...envs, envArg);

	// Set up phases.
	const configureArgs = ["--disable-dependency-tracking"];
	if (!readlineArg) {
		configureArgs.push("--without-readline");
	}
	if (someOptionalFeature) {
		configureArgs.push("--some-optional-feature");
	}
	const configure = { args: configureArgs };
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: sourceArg ?? source(),
		},
		autotools,
	);
});

export default default_;

///////////// Exec

// These are all equivalent ways to create an executable target to run with `tgx`. A is sugar for B is sugar for C is sugar for D.
// TODO - is it a function (...args: Array<tg.Value>) or `(...args: std.Args<tg.Target.Arg>)`?

export const run = makeExecCommand(default_, "bin/sqlite3");

export const execB = makeExecCommand(default_, "bin/sqlite3", "file"); // can choose `file` or `symlink`

export const execC = async () => {
	const executable = await default_()
		.then((dir) => dir.get("bin/sqlite3"))
		.then(tg.File.expect);
	return makeExecCommandWithExecutable(executable);
};

export const execD = async () => {
	const executable = await default_()
		.then((dir) => dir.get("bin/sqlite3"))
		.then(tg.File.expect);
	return (...args: Array<tg.Value>) => {
		// TODO - this should tg.run(...);
		// Should we instead return a function that accepts any target args?
		return tg.target({ executable, args });
	};
};

////////////// Spec/Tests

/** The expected contents of the output directory tree. */
// NOTE - generated via utility, (dir: tg.Directory) => PackageProvides - the user will run this on a new package to create the spec.
export const provides: PackageProvides = {
	binaries: ["sqlite3"],
	headers: ["sqlite3.h", "sqlite3ext.h"],
	libraries: ["sqlite3"],
	// OR
	libraries: [
		{ name: "sqlite3", dylib: true, staticlib: true, pkgConfigName: "sqlite3" },
	], // These paths exist: `lib/libsqlite3.${dylibExt}`, `lib/libsqlite3.a`, `lib/pkgconfig/sqlite3.pc`
};

/** The spec defines the expected behavior. A `PackageProvides` is a valid spec unmodified, or it can modified. */
export const spec: std.assert.PackageSpec = {
	...provides,
	binaries: provides.binaries.map((name) =>
		displaysVersion(name, metadata.version),
	), // a BinarySpec specifies args to pass and a test predicate `(stdout: string) => boolean`. We define helpers for common ones.
};

// The default test target tests the build with no args against the default spec.
export const test = tg.target(() => stdAssertPkg(default_, spec));

export const testAll = tg.target(async () => {
	// Generate all the permutations of package args to test.
	const allPackageArgs = generatePackageArgs<Arg>(metadata);
	// Associate all the args with their expected spec. This example uses the default for all cases.
	const allTests: Array<[Arg, std.assert.PackageSpec]> = allPackageArgs.map(
		(arg) => [arg, spec],
	);
	// Run all tests
	return await stdAssertPkg(default_, spec, ...allTests);
});

////// Below this point, all functions and types will live in std - here for illustration.

// Some options for tuning the generation - this can generate huge matrices quickly.
type GenerateArgsOptions = {
	// Should we be able to cross-compile to a different arch, same OS?
	crossArch?: boolean;
	// Should we be able to cross-compile to a different OS, same arch?
	crossOs?: boolean;
	// Should we be able to cross both arch and os?
	crossArchAndOs?: boolean;
	// Should we try toggling all booleans on and off?
	toggleBools?: boolean;
};

/** Generate all permutations of package arg. */
const generatePackageArgs = <T>(
	metadata: std.assert.Metadata,
	options?: GenerateArgsOptions,
): Array<T> => {
	return tg.unimplemented();
};

export const displaysVersion = (name: string, version: string) => {
	return {
		name,
		testArgs: ["--version"],
		testPredicate: (stdout: string) => stdout.includes(version),
	};
};

type PackageProvides = {
	binaries: Array<string>;
	headers: Array<string>;
	libraries: Array<string | LibraryDescription>;
};

type LibraryDescription = {
	name: string;
	dylib: boolean;
	staticlib: boolean;
	pkgConfigName?: string;
};

const stdAssertPkg = <T>(
	buildCmd: BuildCommand,
	spec: std.assert.PackageSpec,
	...argSpecPairs: Array<[T, std.assert.PackageSpec]>
): Promise<boolean> => {
	// If no argSpecPairs were passed, run the build command with no args passed, and use the default package spec.

	// If pairs were provided, for each member of argSpecPairs, build `buildCmd(arg) and assert against the spec.

	return tg.unimplemented();
};

/** Omit the build and host args from the dependency arg type, as we fill those in. */
type DependencyArg<T> = Omit<T, "build" | "host">;

type BuildCommand = (
	...args: Array<any>
) => Promise<tg.Directory> | tg.Target<any, tg.Directory>;

export const makeExecCommand = (
	buildCmd: BuildCommand,
	subpath: string,
	kind?: "file" | "symlink",
): ((...args: Array<tg.Value>) => tg.Target) => {
	return tg.unimplemented();
};

export const makeExecCommandWithExecutable = (
	executable: tg.File | tg.Symlink,
): ((...args: Array<tg.Value>) => tg.Target) => {
	return tg.unimplemented();
};

// NOTE - the return type could be any `std.env.Arg` but in practice it is always `tg.Directory`.
const stdMakeDependencyEnvArg = async <T>(
	build: string,
	env: std.env.Arg,
	host: string,
	sdk: std.sdk.Arg,
	dependency: Dependency<T>,
): Promise<tg.Directory> => {
	const { buildCmd, arg, subdirs, setHostToBuild, inheritEnv, inheritSdk } =
		dependencyObjectFromDependency(dependency);

	const host_ = setHostToBuild ? build : host;

	let buildArg = { ...arg, build, host: host_ } as T;

	if (inheritEnv) {
		buildArg = { ...buildArg, env };
	}

	if (inheritSdk) {
		buildArg = { ...buildArg, sdk };
	}

	let output =
		buildCmd instanceof tg.Target
			? await buildCmd(buildArg).then((t) => t.output())
			: buildCmd(buildArg);

	if (subdirs !== undefined) {
		output = await std.directory.keepSubdirectories(output, ...subdirs);
	}

	return output;
};

const dependency = <T>(
	buildCmd: BuildCommand,
	arg?: T,
): DependencyObject<T> => {
	return {
		buildCmd,
		arg,
	};
};

const buildDependency = <T>(
	buildCmd: BuildCommand,
	arg?: T,
): DependencyObject<T> => {
	return {
		subdirs: ["bin"],
		buildCmd,
		arg,
		inheritEnv: false,
		inheritSdk: false,
		setHostToBuild: true,
	};
};

const runtimeDependency = <T>(
	buildCmd: BuildCommand,
	arg?: T,
): DependencyObject<T> => {
	return {
		subdirs: ["include", "lib"],
		buildCmd,
		arg,
		inheritEnv: false,
		inheritSdk: true,
		setHostToBuild: false,
	};
};

type Dependency<T> = BuildCommand | DependencyObject<T>;

const dependencyObjectFromDependency = <T>(
	dependency: Dependency<T>,
): DependencyObject<T> => {
	if (isDependencyObject(dependency)) {
		return dependency;
	} else {
		return { buildCmd: dependency };
	}
};

const dependenyObjectFromBuildCommand = (buildCmd: BuildCommand) => {
	return {
		buildCmd,
	};
};

type DependencyObject<T> = {
	arg?: T | undefined;
	buildCmd: BuildCommand;
	subdirs?: Array<string>; // For build, this is bin/, for runtime, this is include/ and lib/ and optionally bin/. This reduces the baggage carried in by producing a new top-level directory ID with only relevant subdirs.
	setHostToBuild?: boolean;
	inheritEnv?: boolean;
	inheritSdk?: boolean;
};

const isDependencyObject = <T>(arg: unknown): arg is DependencyObject<T> => {
	return tg.unimplemented();
};
