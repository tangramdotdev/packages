import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "go",
	version: "1.21.5",
};

// See https://go.dev/dl.
let RELEASES = {
	["aarch64-linux"]: {
		checksum:
			"sha256:841cced7ecda9b2014f139f5bab5ae31785f35399f236b8b3e75dff2a2978d96",
		url: `https://go.dev/dl/go${metadata.version}.linux-arm64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:e2bc0b3e4b64111ec117295c088bde5f00eeed1567999ff77bc859d7df70078e",
		url: `https://go.dev/dl/go${metadata.version}.linux-amd64.tar.gz`,
	},
	["aarch64-macos"]: {
		checksum:
			"sha256:8c294f1c6287d630485919c05b1f620cc26398735c1e1babe65797b93292a874",
		url: `https://go.dev/dl/go${metadata.version}.darwin-arm64.tar.gz`,
	},
	["x86_64-macos"]: {
		checksum:
			"sha256:4fddd8f73c6151c96556cbb7bb6b473396f52385e874503e9204264aa39aa422",
		url: `https://go.dev/dl/go${metadata.version}.darwin-amd64.tar.gz`,
	},
};

export let go = tg.target(async (): Promise<tg.Directory> => {
	let target = await std.Triple.hostSystem();
	tg.assert(
		target in RELEASES,
		`${target} is not supported in the Go toolchain.`,
	);

	let { checksum, url } = RELEASES[target as keyof typeof RELEASES];

	let unpackFormat = ".tar.gz" as const;

	// Download the Go toolchain from `go.dev`.
	let downloaded = await std.download({
		checksum,
		unpackFormat,
		url,
	});

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
});

export default go;

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

	cgo?: boolean;

	build?: std.Triple.Arg;

	host?: std.Triple.Arg;

	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
};

export let build = async (...args: tg.Args<Arg>): Promise<tg.Directory> => {
	type Apply = {
		build: std.Triple.Arg;
		cgo: boolean;
		env: Array<std.env.Arg>;
		generate: boolean | { command: tg.Template.Arg };
		host: std.Triple.Arg;
		install: { command: tg.Template.Arg };
		sdkArgs: Array<std.sdk.Arg>;
		source: tg.Directory;
		vendor: boolean | { command: tg.Template.Arg };
	};

	let {
		build: build_,
		cgo,
		env: env_,
		generate,
		host: host_,
		install,
		sdkArgs,
		source,
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
			if (arg.build !== undefined) {
				object.host = arg.host;
			}
			if (arg.host !== undefined) {
				object.host = arg.host;
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
	let host = await std.Triple.host(host_);
	let build = build_ ? std.triple(build_) : host;
	tg.assert(source, "Must provide a source directory.");

	let sdk = std.sdk(std.Triple.rotate({ build, host }), sdkArgs);

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
	let goArtifact = go();

	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let cgoEnabled = cgo ? "1" : "0";
	let env = [sdk, goArtifact, { CGO_ENABLED: cgoEnabled, SSL_CERT_FILE: certFile }];

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
	// TODO: Prune down the artifact to just `go.mod` and `go.sum`. Somehow make this work, where this target will hit cache for changed source code using the same dependencies. This is tricky, because Go will only vendor the dependencies that are used by actual source code. Perhaps we could generate a dummy `main.go` that just imports everything in `go.mod`?
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
				go(),
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
		{ env: [std.sdk(), go()] },
	);
});
