import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://go.dev/",
	license: "BSD-3-Clause",
	name: "go",
	repository: "https://github.com/golang/go",
	version: "1.23.2",
};

// See https://go.dev/dl.
const RELEASES = {
	["aarch64-linux"]: {
		checksum:
			"sha256:f626cdd92fc21a88b31c1251f419c17782933a42903db87a174ce74eeecc66a9",
		url: `https://go.dev/dl/go${metadata.version}.linux-arm64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:542d3c1705f1c6a1c5a80d5dc62e2e45171af291e755d591c5e6531ef63b454e",
		url: `https://go.dev/dl/go${metadata.version}.linux-amd64.tar.gz`,
	},
	["aarch64-darwin"]: {
		checksum:
			"sha256:d87031194fe3e01abdcaf3c7302148ade97a7add6eac3fec26765bcb3207b80f",
		url: `https://go.dev/dl/go${metadata.version}.darwin-arm64.tar.gz`,
	},
	["x86_64-darwin"]: {
		checksum:
			"sha256:445c0ef19d8692283f4c3a92052cc0568f5a048f4e546105f58e991d4aea54f5",
		url: `https://go.dev/dl/go${metadata.version}.darwin-amd64.tar.gz`,
	},
};

export type ToolchainArg = {
	host?: string;
};

export const toolchain = tg.target(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		const host = arg?.host ?? (await std.triple.host());
		const system = std.triple.archAndOs(host);
		tg.assert(
			system in RELEASES,
			`${system} is not supported in the Go toolchain.`,
		);

		const { checksum, url } = RELEASES[system as keyof typeof RELEASES];

		// Download the Go toolchain from `go.dev`.
		const downloaded = await std.download({ checksum, url });

		tg.assert(downloaded instanceof tg.Directory);
		const go = await downloaded.get("go");
		tg.assert(go instanceof tg.Directory);

		let artifact = tg.directory();
		for (const bin of ["bin/go", "bin/gofmt"]) {
			const file = await go.get(bin);
			tg.assert(file instanceof tg.File);
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
	/** If the build requires network access, provide a checksum or the string "unsafe" to accept any result. */
	checksum?: tg.Checksum;

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
	sdk?: std.sdk.Arg;
};

export const build = tg.target(
	async (...args: std.Args<Arg>): Promise<tg.Directory> => {
		const mutationArgs = await std.args.createMutations<
			Arg,
			std.args.MakeArrayKeys<Arg, "env" | "sdk">
		>(std.flatten(args), {
			env: "append",
			sdk: "append",
			source: "set",
		});
		let {
			checksum,
			cgo,
			env: env_,
			generate,
			host: host_,
			install,
			sdk: sdkArgs,
			source,
			target: target_,
			vendor: vendor_,
		} = await std.args.applyMutations(mutationArgs);
		const host = host_ ?? (await std.triple.host());
		const system = std.triple.archAndOs(host);
		const target = target_ ?? host;
		tg.assert(source, "Must provide a source directory.");

		const sdk = std.sdk({ host, target }, sdkArgs);

		// Check if the build has a vendor dir, then determine whether or not we're going to be vendoring dependencies.
		const willVendor =
			vendor_ === true ||
			(vendor_ !== false && (await source.tryGet("vendor")));

		// If we need to, vendor the build's dependencies.
		let buildArgs = "";

		if (willVendor) {
			// Vendor the build, and insert the `vendor` dir in the source artifact.
			const vendorCommand =
				typeof vendor_ === "object" ? vendor_.command : undefined;
			const vendorArtifact = await vendor({
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
		const goArtifact = toolchain({ host });

		const certFile = tg`${std.caCertificates()}/cacert.pem`;
		const cgoEnabled = cgo ? "1" : "0";
		const env = std.env(
			sdk,
			goArtifact,
			{
				CGO_ENABLED: cgoEnabled,
				SSL_CERT_FILE: certFile,
				TANGRAM_HOST: system,
			},
			env_,
		);

		const output = await $`
				cp -rT ${source}/. .
				chmod -R u+w .

				export TMPDIR=$PWD/tmp
				mkdir -p $TMPDIR
				mkdir -p $OUTPUT/bin

				export GOBIN=$OUTPUT/bin
				export GOCACHE=$TMPDIR
				export GOMODCACHE=$TMPDIR
				export GOTMPDIR=$TMPDIR

				# Build Go.
				${generateCommand}
				${installCommand}
			`
			.env(env)
			.host(host)
			.checksum(checksum)
			.then(tg.Directory.expect);

		// Get a list of all dynamically-linked binaries in the output.
		let binDir = await output.get("bin").then(tg.Directory.expect);

		// Wrap each executable in the /bin directory.
		for await (const [name, file] of binDir) {
			if (!(file instanceof tg.Directory)) {
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
	},
);

export type VendorArgs = {
	source: tg.Directory;
	/** Command to run to vendor the deps, by default `go mod vendor`. */
	command?: tg.Unresolved<tg.Template.Arg>;
};

export const vendor = async ({
	command: optionalCommand,
	source,
}: VendorArgs): Promise<tg.Directory> => {
	const pruned = source;

	const command = optionalCommand ?? tg`go mod vendor -v`;
	return await $`
				export GOMODCACHE="$(mktemp -d)"

				# Create a writable temp dir.
				work="$(mktemp -d)" && cp -r -T '${pruned}/' "$work" && cd "$work"
				mkdir -p "$OUTPUT"

				${command}

				mv -T ./vendor "$OUTPUT"
			`
		.env(toolchain(), { SSL_CERT_DIR: std.caCertificates() })
		.then(tg.Directory.expect);
};

// add cgo test.

export const test = tg.target(async () => {
	const source = tg.directory({
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

	return await $`
				set -ex
				echo $TMPDIR
				export TMPDIR=$PWD/tmp
				mkdir -p $TMPDIR
				export GOCACHE=$TMPDIR
				export GOMODCACHE=$TMPDIR
				export GOTMPDIR=$TMPDIR
				mkdir -p $OUTPUT
				cp -R ${source}/. .
				chmod -R u+w .
				go env
				go mod init main.go
				go mod tidy
				go run main.go
				go run ./subcommand.go
			`.env(std.sdk(), toolchain());
});
