import * as make from "gnumake" with { path: "../gnumake" };
import * as nodejs from "nodejs" with { path: "../nodejs" };
import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	home: "https://esbuild.github.io",
	license: "MIT",
	name: "esbuild",
	repository: "https://github.com/evanw/esbuild",
	version: "0.25.2",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:01a6c0a5949e5c2d53e19be52aec152b3186f8bbcf98df6996a20a972a78c330";
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
});

export type Arg = {
	dependencies?: {
		go?: go.Arg;
		nodejs?: nodejs.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		dependencies: { go: goArg = {}, nodejs: nodejsArg = {} } = {},
		env: env_,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	const phases = {
		prepare: tg`cp -R ${sourceDir}/* .
			chmod -R u+w .
			TMPDIR=$PWD/tmp
			mkdir -p $TMPDIR
			export GOCACHE=$TMPDIR
			export GOTMPDIR=$TMPDIR
			export GOMODCACHE=$TMPDIR`,
		build: { command: "make" },
		install: {
			command: "mkdir -p $OUTPUT/bin && cp esbuild $OUTPUT/bin",
			args: tg.Mutation.unset(),
		},
	};

	const certFile = tg`${std.caCertificates()}/cacert.pem`;

	const env = std.env.arg(
		std.sdk({ host }),
		go.self(goArg),
		nodejs.self(nodejsArg),
		make.build({ host }),
		{
			SSL_CERT_FILE: certFile,
		},
		env_,
	);

	return std.phases
		.run({
			command: { host },
			env,
			phases,
			source: source_ ?? source(),
			checksum: "any",
			network: true,
		})
		.then(tg.Directory.expect);
});

export default build;

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
