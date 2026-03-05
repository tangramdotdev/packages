import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import git from "git" with { local: "./git.tg.ts" };
import ninja from "ninja" with { local: "./ninja.tg.ts" };
import python from "python" with { local: "./python" };

export const metadata = {
	homepage: "https://gn.googlesource.com/gn",
	license: "BSD-3-Clause",
	name: "gn",
	repository: "https://gn.googlesource.com/gn",
	version: "0.2216",
	tag: "gn/0.2216",
	provides: {
		binaries: ["gn"],
	},
};

// Pinned commit from V8 146's DEPS file.
const commit = "103f8b437f5e791e0aef9d5c372521a5d675fabb";

export const source = async (buildHost?: string) => {
	const host = buildHost ?? std.triple.host();
	const certFile = tg`${std.caCertificates()}/cacert.pem`;
	const env = std.env.arg(git({ host }), {
		SSL_CERT_FILE: certFile,
	});
	return await $`
		git clone https://gn.googlesource.com/gn ${tg.output}
		cd ${tg.output}
		git checkout ${commit}
	`
		.env(env)
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);
};

export const deps = () =>
	std.deps({
		git: { build: git, kind: "buildtime" },
		ninja: { build: ninja, kind: "buildtime" },
		python: { build: python, kind: "buildtime" },
	});

export type Arg = std.args.BasePackageArg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		env: env_,
		host,
		sdk,
		source: source_,
		dependencies,
		subtreeEnv,
		subtreeSdk,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? (await source(build));

	// Resolve deps to an environment.
	const depsEnv = await std.deps.env(deps(), {
		build,
		host,
		sdk,
		dependencies,
		env: env_,
		subtreeEnv,
		subtreeSdk,
	});

	const env = std.env.arg(
		std.sdk({ host: build, target: host, toolchain: "llvm", ...sdk }),
		depsEnv,
	);

	return await $`
		cp -R ${sourceDir}/. work
		chmod -R u+w work
		cd work
		export CXXFLAGS="-Wno-unused-command-line-argument"
		python3 build/gen.py
		ninja -C out gn
		mkdir -p ${tg.output}/bin
		cp out/gn ${tg.output}/bin/gn
	`
		.env(env)
		.then(tg.Directory.expect);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
