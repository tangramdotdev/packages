import * as perl from "perl" with { source: "./perl" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://github.com/julian-klode/triehash",
	license: "MIT",
	name: "triehash",
	repository: "https://github.com/julian-klode/triehash",
	version: "0.3",
	tag: "triehash/0.3",
	provides: {
		binaries: ["triehash"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:289a0966c02c2008cd263d3913a8e3c84c97b8ded3e08373d63a382c71d2199c";
	return std.download.fromGithub({
		checksum,
		owner: "julian-klode",
		repo: name,
		source: "tag",
		tag: `v${version}`,
	});
}

export type Arg = {
	build?: string;
	host?: string;
};

export async function build(arg?: Arg) {
	// The program is a single Perl script, so run it with the perl interpreter of the host.
	const host = arg?.host ?? std.triple.host();
	const build_ = arg?.build ?? host;
	const script = await source()
		.then((directory) => directory.get("triehash.pl"))
		.then(tg.File.expect);
	const perlArtifact = await perl.build({ build: build_, host });
	const interpreter = tg.symlink({ artifact: perlArtifact, path: "bin/perl" });
	return tg.directory({
		["bin/triehash"]: std.wrap(script, { host, interpreter }),
	});
}

export default build;

export async function test() {
	// Generate a perfect hash function for two words and check that the header declares the lookup function.
	const output = await $`
		set -eu
		mkdir -p ${tg.output}
		printf 'Hello\nWorld\n' > words
		triehash --ignore-case --function-name=lookup --header=${tg.output}/hash.h --code=code.cc words
		grep -q 'lookup' code.cc
	`
		.env(build())
		.then(tg.Directory.expect);
	const header = await output
		.get("hash.h")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(header.includes("lookup"), `unexpected header: ${header}`);
	return true;
}
