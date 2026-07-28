import * as make from "gnumake" with { source: "./gnumake.tg.ts" };
import * as nodejs from "nodejs" with { source: "./nodejs.tg.ts" };
import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };

export const metadata = {
	home: "https://esbuild.github.io",
	license: "MIT",
	name: "esbuild",
	repository: "https://github.com/evanw/esbuild",
	version: "0.28.1",
	tag: "esbuild/0.28.1",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:65c756fa87d43178ac4a5242454c2bd0fde325f8ecf77997f8fa4b88f94d5cd2";
	const owner = "evanw";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export type Arg = std.args.BasePackageArg & {
	dependencies?: {
		go?: Omit<go.Arg, "deps">;
		nodejs?: Omit<nodejs.Arg, "deps">;
	};
};

export async function build(...args: tg.Args<Arg>) {
	const {
		dependencies: { go: goArg = {}, nodejs: nodejsArg = {} } = {},
		env: env_,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? source();

	const certFile = tg`${std.caCertificates()}/cacert.pem`;
	const env = std.env.arg(
		std.sdk({ host }),
		go.self(goArg),
		nodejs.self(nodejsArg),
		make.build({ host }),
		{
			SSL_CERT_FILE: certFile,
		},
		env_ ?? null,
	);

	return await $`mkdir work
		cp -R ${sourceDir}/* ./work
		chmod -R u+w ./work
		TMPDIR=$PWD/tmp
		mkdir -p $TMPDIR
		export GOCACHE=$TMPDIR
		export GOTMPDIR=$TMPDIR
		export GOMODCACHE=$TMPDIR
		cd work
		make
		mkdir -p ${tg.output}/bin
		cp esbuild ${tg.output}/bin
	`
		.env(env)
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
