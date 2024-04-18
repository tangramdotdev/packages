import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "go",
	version: "1.22.1",
};

// See https://go.dev/dl.
let RELEASES = {
	["aarch64-linux"]: {
		checksum:
			"sha256:e56685a245b6a0c592fc4a55f0b7803af5b3f827aaa29feab1f40e491acf35b8",
		url: `https://go.dev/dl/go${metadata.version}.linux-arm64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:aab8e15785c997ae20f9c88422ee35d962c4562212bb0f879d052a35c8307c7f",
		url: `https://go.dev/dl/go${metadata.version}.linux-amd64.tar.gz`,
	},
	["aarch64-darwin"]: {
		checksum:
			"sha256:5f10b95e2678618f85ba9d87fbed506b3b87efc9d5a8cafda939055cb97949ba",
		url: `https://go.dev/dl/go${metadata.version}.darwin-arm64.tar.gz`,
	},
	["x86_64-darwin"]: {
		checksum:
			"sha245:943e4f9f038239f9911c44366f52ab9202f6ee13610322a668fe42406fb3deef",
		url: `https://go.dev/dl/go${metadata.version}.darwin-amd64.tar.gz`,
	},
};

type ToolchainArg = {
	host?: string;
};

export let toolchain = tg.target(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		let host = arg?.host ?? (await std.triple.host());
		let system = std.triple.archAndOs(host);
		tg.assert(
			system in RELEASES,
			`${system} is not supported in the Go toolchain.`,
		);

		let { checksum, url } = RELEASES[system as keyof typeof RELEASES];

		// Download the Go toolchain from `go.dev`.
		let downloaded = await std.download({ checksum, url });

		tg.assert(tg.Directory.is(downloaded));
		let go = await downloaded.get("go");
		tg.assert(tg.Directory.is(go));

		let artifact = tg.directory();
		for (let bin of ["bin/go", "bin/gofmt"]) {
			let file = await go.get(bin);
			tg.assert(tg.File.is(file));
			artifact = tg.directory(artifact, {
				[bin]: std.wrap(file, {
					env: {
						GOROOT: go,
					},
				}),
			});
		}

		return artifact;
	},
);

export default toolchain;

export type Arg = {
	/**
	 * Explicitly enable or disable updating vendored dependencies, or override the command used in the vendor phase.
	 *
	 * Configure how we vendor dependencies:
	 * - `undefined` (default): Update dependencies if `vendor` dir is not present.
	 * - `false`: Never update dependencies.
	 * - `true`: Always update dependencies.
	 * - `{command: ...}`: Always update dependencies, and override the specific command used.
	 *
	 * By default, we re-vendor dependencies if there is no `vendor` directory in the root of the `source`.
	 */
	source: tg.Directory;

	/**
	 * Configure the installation phase, where binaries are built and copied to the output.
	 *
	 * If set, `command` will be run instead of `go install` to build the output binaries.
	 */
	vendor?: boolean | { command: tg.Template.Arg };

	/**
	 * Explicitly enable or disable the `go generate` phase.
	 * - `false`, `undefined` (default): Never run `go generate`.
	 * - `true`: Always run `go generate`.
	 * - `{command: ...}`: Always run `go generate`, and override the specific command used.
	 */
	generate?: boolean | { command: tg.Template.Arg };

	/** An optional override to the `go install` command. */
	install?: { command: tg.Template.Arg };

	/**
	 * Any user-specified environment environment variables that will be set during the build.
	 */
	env?: std.env.Arg;

	/** Should cgo be enabled? Default: true. */
	cgo?: boolean;

	/** The machine that will run the compilation. */
	host?: string;

	/** The machine the produced artifacts will run on. */
	target?: string;

	/** Any required SDK customization. */
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
};

export let build = async (...args: tg.Args<Arg>): Promise<tg.Directory> => {
	type Apply = {
		cgo: boolean;
		env: Array<std.env.Arg>;
		generate: boolean | { command: tg.Template.Arg };
		host: string;
		install: { command: tg.Template.Arg };
		sdkArgs: Array<std.sdk.Arg>;
		source: tg.Directory;
		target: string;
		vendor: boolean | { command: tg.Template.Arg };
	};

	let {
		cgo,
		env: env_,
		generate,
		host: host_,
		install,
		sdkArgs,
		source,
		target: target_,
		vendor: vendor_,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else {
			let object: tg.MutationMap<Apply> = {};
			if (arg.source !== undefined) {
				object.source = arg.source;
			}
			if (arg.cgo !== undefined) {
				object.cgo = arg.cgo;
			}
			if (arg.vendor !== undefined) {
				object.vendor = arg.vendor;
			}
			if (arg.generate !== undefined) {
				object.generate = arg.generate;
			}
			if (arg.install !== undefined) {
				object.install = arg.install;
			}
			if (arg.host !== undefined) {
				object.host = arg.host;
			}
			if (arg.target !== undefined) {
				object.target = arg.target;
			}
			if (arg.env !== undefined) {
				object.env = tg.Mutation.is(arg.env)
					? arg.env
					: await tg.Mutation.arrayAppend<std.env.Arg>(arg.env);
			}
			if (arg.sdk !== undefined) {
				object.sdkArgs = tg.Mutation.is(arg.sdk)
					? arg.sdk
					: await tg.Mutation.arrayAppend<std.sdk.Arg>(arg.sdk);
			}
			return object;
		}
	});
	let host = host_ ?? (await std.triple.host());
	let system = std.triple.archAndOs(host);
	let target = target_ ?? host;
	tg.assert(source, "Must provide a source directory.");

	let sdk = std.sdk({ host, target }, sdkArgs);

	// Check if the build has a vendor dir, then determine whether or not we're going to be vendoring dependencies.
	let willVendor =
		vendor_ === true || (vendor_ !== false && (await source.tryGet("vendor")));

	// If we need to, vendor the build's dependencies.
	let buildArgs = "";

	if (willVendor) {
		// Vendor the build, and insert the `vendor` dir in the source artifact.
		let vendorCommand =
			typeof vendor_ === "object" ? vendor_.command : undefined;
		let vendorArtifact = await vendor({
			command: vendorCommand,
			source,
		});

		source = await tg.directory(source, {
			["vendor"]: vendorArtifact,
		});

		// We need to pass the `-mod=vendor` to obey the vendored dependencies.
		buildArgs = "-mod=vendor";
	}

	// Come up with the right command to run in the `go generate` phase.
	let generateCommand = await tg`go generate -v -x`;
	if (generate === false) {
		generateCommand =
			await tg`echo "'go generate' phase disabled by 'generate: false'"`;
	} else if (typeof generate === "object") {
		generateCommand = await tg.template(generate.command);
	}

	// Come up with the right command to run in the `go install` phase.
	let installCommand = await tg`go install -v ${buildArgs}`;
	if (install) {
		installCommand = await tg.template(install.command);
	}

	// Build the vendored source code without internet access.
	let goArtifact = toolchain({ host });

	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let cgoEnabled = cgo ? "1" : "0";
	let env = std.env(
		sdk,
		goArtifact,
		{ CGO_ENABLED: cgoEnabled, SSL_CERT_FILE: certFile, TANGRAM_HOST: system },
		env_,
	);

	let output = await std.build(
		tg`
				set -x
				# Copy the build tree into the working directory
				cp -rT ${source}/. .
				chmod -R u+w .

				export TEMPDIR=$(mktemp -d)
				mkdir -p $OUTPUT/bin

				export GOBIN=$OUTPUT/bin
				export GOCACHE=$TEMPDIR
				export GOMODCACHE=$TEMPDIR

				# Build Go.
				${generateCommand}
				${installCommand}
			`,
		{
			host,
			env,
			checksum: "unsafe",
		},
	);

	tg.assert(tg.Directory.is(output));

	// Get a list of all dynamically-linked binaries in the output.
	let binDir = await output.get("bin");
	tg.assert(tg.Directory.is(binDir));

	// Wrap each executable in the /bin directory.
	for await (let [name, file] of binDir) {
		if (!tg.Directory.is(file)) {
			binDir = await tg.directory(binDir, {
				[name]: std.wrap({
					executable: file,
					identity: "wrapper",
				}),
			});
		}
	}

	// Return the output.
	return tg.directory(source, {
		["bin"]: binDir,
	});
};

export type VendorArgs = {
	source: tg.Directory;
	/** Command to run to vendor the deps, by default `go mod vendor`. */
	command?: tg.Unresolved<tg.Template.Arg>;
};

export let vendor = async ({
	command: optionalCommand,
	source,
}: VendorArgs): Promise<tg.Directory> => {
	let pruned = source;

	let command = optionalCommand ?? tg`go mod vendor -v`;
	let result = await std.build(
		tg`
				export GOMODCACHE="$(mktemp -d)"

				# Create a writable temp dir.
				work="$(mktemp -d)" && cp -r -T '${pruned}/' "$work" && cd "$work"
				mkdir -p "$OUTPUT"

				${command}

				mv -T ./vendor "$OUTPUT"
			`,
		{
			env: [
				toolchain(),
				{
					SSL_CERT_DIR: std.caCertificates(),
				},
			],
		},
	);

	return tg.Directory.expect(result);
};

export let test = tg.target(() => {
	let source = tg.directory({
		["main.go"]: tg.file(`
			package main
			import "fmt"

			func main() {
					fmt.Println("hello world")
			}
		`),
		["subcommand.go"]: tg.file(`
			package main
			import "os/exec"

			func main() {
				helloCmd := exec.Command("go", "run", "main.go")
				error := helloCmd.Start()

				if error != nil {
					panic(error)
				}

				error = helloCmd.Wait()
				if (error != nil) {
					panic(error)
				}
			}
		`),
	});

	return std.build(
		tg`
				mkdir -p $OUTPUT
				cp -r ${source}/. .
				chmod -R u+w .
				go env
				go mod init main.go
				go mod tidy
				go run main.go
				go run ./subcommand.go
			`,
		{ env: [std.sdk(), toolchain()] },
	);
});
