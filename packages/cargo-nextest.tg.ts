import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://nexte.st",
	license: "Apache-2.0, MIT",
	name: "cargo-nextest",
	repository: "https://github.com/nextest-rs/nextest",
	version: "0.9.143",
	tag: "cargo-nextest/0.9.143",
	provides: {
		binaries: ["cargo-nextest"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:4ad5dbe9e266fd7303c39413c5610c4ca03f3c1b70f8d59c81266a4452e59361";
	const owner = "nextest-rs";
	const repo = "nextest";
	const tag = `${name}-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export type Arg = cargo.Arg;

export function build(...args: tg.Args<Arg>) {
	// The repository is a workspace, so select the one member that produces the
	// binary. Its default features include `self-update`, which pulls in rustls
	// and ureq for a code path that can never run from a Tangram artifact.
	return cargo.build(
		{
			disableDefaultFeatures: true,
			packages: [metadata.name],
			source: source(),
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		// The binary is a cargo subcommand, so it reports its version under the
		// `nextest` subcommand rather than at the top level.
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["nextest", "--version"],
			snapshot: metadata.version,
		}),
	};
	return await std.assert.pkg(build, spec);
}
