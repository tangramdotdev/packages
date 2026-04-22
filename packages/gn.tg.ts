import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
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

// Pinned commit compatible with V8 146.
const commit = "20a26907f754fed7927e5c5fd103a23a3a528cdf";

export const source = async () => {
	const checksum = "sha256:any";
	const url = `https://gn.googlesource.com/gn/+archive/${commit}.tar.gz`;
	// googlesource archives are flat (no top-level directory).
	return await std
		.download({ checksum, url, mode: "extract" })
		.then(tg.Directory.expect);
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			sdk: (a, b) => std.sdk.arg(a, b),
		},
	});
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	const sourceDir = await source();

	const env = std.env.arg(
		std.sdk({ host: build, target: host, toolchain: "llvm", ...sdk }),
		ninja({ build, host: build }),
		python({ build, host: build }),
		env_,
	);

	return await $`
		cp -R ${sourceDir}/. work
		chmod -R u+w work
		cd work
		python3 build/gen.py --no-last-commit-position
		ninja -C out gn
		mkdir -p $OUTPUT/bin
		cp out/gn $OUTPUT/bin/gn
	`
		.checksum("sha256:any")
		.env(env)
		.then(tg.Directory.expect);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
