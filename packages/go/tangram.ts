import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://go.dev/",
	license: "BSD-3-Clause",
	name: "go",
	repository: "https://github.com/golang/go",
	version: "1.24.2",
};

// See https://go.dev/dl.
const RELEASES: { [key: string]: { checksum: tg.Checksum; url: string } } = {
	["aarch64-linux"]: {
		checksum:
			"sha256:756274ea4b68fa5535eb9fe2559889287d725a8da63c6aae4d5f23778c229f4b",
		url: `https://go.dev/dl/go${metadata.version}.linux-arm64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:68097bd680839cbc9d464a0edce4f7c333975e27a90246890e9f1078c7e702ad",
		url: `https://go.dev/dl/go${metadata.version}.linux-amd64.tar.gz`,
	},
	["aarch64-darwin"]: {
		checksum:
			"sha256:b70f8b3c5b4ccb0ad4ffa5ee91cd38075df20fdbd953a1daedd47f50fbcff47a",
		url: `https://go.dev/dl/go${metadata.version}.darwin-arm64.tar.gz`,
	},
	["x86_64-darwin"]: {
		checksum:
			"sha256:238d9c065d09ff6af229d2e3b8b5e85e688318d69f4006fb85a96e41c216ea83",
		url: `https://go.dev/dl/go${metadata.version}.darwin-amd64.tar.gz`,
	},
};

export type ToolchainArg = {
	host?: string;
};

export const self = async (
	arg?: tg.Unresolved<ToolchainArg>,
): Promise<tg.Directory> => {
	const resolved = await tg.resolve(arg);
	const host = resolved?.host ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
	tg.assert(
		system in RELEASES,
		`${system} is not supported in the Go toolchain.`,
	);

	const release = RELEASES[system as keyof typeof RELEASES];
	tg.assert(release !== undefined);
	const { checksum, url } = release;

	// Download the Go toolchain from `go.dev`.
	const downloaded = await std.download.extractArchive({ checksum, url });

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
};

export default self;

export type Arg = {
	/** If the build requires network access, provide a checksum or the string "sha256:any" to accept any result, or `sha256:none` to ensure a failure, displaying the computed value. */
	checksum?: tg.Checksum;

	/** The source directory. */
	source: tg.Directory;

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
	vendor?: boolean | { command: tg.Template.Arg };

	/**
	 * Explicitly enable or disable the `go generate` phase.
	 * - `false`, `undefined` (default): Never run `go generate`.
	 * - `true`: Always run `go generate`.
	 * - `{command: ...}`: Always run `go generate`, and override the specific command used.
	 */
	generate?: boolean | { command: tg.Template.Arg };

	/**
	 * Configure the installation phase, where binaries are built and copied to the output.
	 *
	 * If set, `command` will be run instead of `go install` to build the output binaries.
	 */
	install?: { command: tg.Template.Arg };

	/**
	 * Any user-specified environment environment variables that will be set during the build.
	 */
	env?: std.env.Arg;

	/** Should cgo be enabled? Default: true. */
	cgo?: boolean;

	/** The machine that will run the compilation. */
	host?: string;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** The machine the produced artifacts will run on. */
	target?: string;

	/** Any required SDK customization. */
	sdk?: std.sdk.Arg;
};

export const build = async (...args: tg.Args<Arg>): Promise<tg.Directory> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const objects = resolved.map((obj) => {
		return {
			...obj,
			env: [obj.env],
			sdk: [obj.sdk],
		};
	});
	let {
		checksum,
		cgo = true,
		env: env_,
		generate,
		host: host_,
		install,
		network = false,
		sdk: sdkArgs,
		source,
		target: target_,
		vendor: vendor_ = true,
	} = (await tg.Args.apply(objects, {
		env: "append",
		sdk: "append",
		source: "set",
	})) as std.args.MakeArrayKeys<Arg, "env" | "sdk">;
	const host = host_ ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
	const target = target_ ?? host;
	tg.assert(source, "Must provide a source directory.");

	const sdk = std.sdk({ host, target }, ...(sdkArgs ?? []));

	// Check if the build has a vendor dir, then determine whether or not we're going to be vendoring dependencies.
	const willVendor =
		vendor_ === true || (vendor_ !== false && (await source.tryGet("vendor")));

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
		buildArgs += "-mod=vendor";
	}

	// Build the vendored source code without internet access.
	const goArtifact = self({ host });

	const certFile = tg`${std.caCertificates()}/cacert.pem`;
	const cgoEnabled = cgo ? "1" : "0";

	// If cgo is enabled on Linux, we need to set linkmode to external to force using the Tangram proxy for every link operation, so that host object files can link to the SDK's libc.
	// On Darwin, this is not necessary because these symbols are provided by the OS in libSystem.dylib, and causes a codesigning failure.
	// See https://github.com/golang/go/blob/30c18878730434027dbefd343aad74963a1fdc48/src/cmd/cgo/doc.go#L999-L1023
	if (cgoEnabled && std.triple.os(system) === "linux") {
		buildArgs += " -ldflags=-linkmode=external";
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

	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		sdk,
		goArtifact,
		{
			CGO_ENABLED: cgoEnabled,
			SSL_CERT_FILE: certFile,
			TANGRAM_HOST: system,
		},
		...(env_ ?? []),
	];

	const env = std.env.arg(...envs);

	const output = await $`
				cp -R ${source}/. ./work
				chmod -R u+w ./work
				cd ./work

				export TMPDIR=$PWD/tmp
				mkdir -p $TMPDIR
				mkdir -p $OUTPUT/bin

				export GOBIN=$OUTPUT/bin
				export GOCACHE=$TMPDIR
				export GOMODCACHE=$TMPDIR
				export GOTMPDIR=$TMPDIR

				${generateCommand}
				${installCommand}
			`
		.env(env)
		.host(host)
		.checksum(checksum)
		.network(network)
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
};

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

	const command = optionalCommand ?? "go mod vendor -v";
	return await $`
				export GOMODCACHE="$(mktemp -d)"

				# Create a writable temp dir.
				work="$(mktemp -d)" && cp -r -T '${pruned}/' "$work" && cd "$work"
				mkdir -p "$OUTPUT"

				${command}

				mv -T ./vendor "$OUTPUT" || true
			`
		.env(self())
		.env({ SSL_CERT_DIR: std.caCertificates() })
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);
};

//TODO spec, add cgo test.

export const test = async () => {
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
				export TMPDIR=$PWD/tmp
				mkdir -p $TMPDIR
				export GOCACHE=$TMPDIR
				export GOMODCACHE=$TMPDIR
				export GOTMPDIR=$TMPDIR
				mkdir -p $OUTPUT
				export WORK=$PWD/work
				cp -R ${source}/. $WORK
				chmod -R u+w $WORK
				cd $WORK
				go env
				go mod init main.go
				go mod tidy
				go run main.go
				go run ./subcommand.go
			`
		.env(std.sdk())
		.env(self());
};
