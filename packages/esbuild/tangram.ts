import * as nodejs from "nodejs" with { path: "../nodejs" };
import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	home: "https://esbuild.github.io",
	license: "MIT",
	name: "esbuild",
	repository: "https://github.com/evanw/esbuild",
	version: "0.21.3",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f81cc2add471cab752845a778f23dace9ece17c487fe178202c07481b9a678b5";
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		dependencies: { go: goArg = {}, nodejs: nodejsArg = {} } = {},
		env: env_,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	const phases = {
		prepare: tg`set -x && cp -R ${sourceDir}/* . && chmod -R u+w .`,
		build: { command: "make" },
		install: {
			command: "mkdir -p $OUTPUT/bin && cp esbuild $OUTPUT/bin",
			args: tg.Mutation.unset(),
		},
	};

	const certFile = tg`${std.caCertificates()}/cacert.pem`;

	const env = std.env.arg(
		std.sdk({ host }),
		go.toolchain(goArg),
		nodejs.nodejs(nodejsArg),
		{
			SSL_CERT_FILE: certFile,
		},
		env_,
	);

	return std.phases
		.build({
			env,
			phases,
			source: source_ ?? source(),
			target: { checksum: "unsafe" },
		})
		.then(tg.Directory.expect);
});

export default build;

export const test = tg.target(async () => {
	return await $`
			echo "Checking that we can run esbuild." | tee $OUTPUT
			echo "$(esbuild --version)" | tee -a $OUTPUT
		`.env(build());
});
