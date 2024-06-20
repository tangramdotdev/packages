import * as flex from "tg:flex" with { path: "../flex" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.erlang.org",
	license: "https://opensource.org/licenses/Apache-2.0",
	name: "erlang",
	repository: "https://github.com/erlang/otp",
	version: "27.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = name;
	let repo = "otp";
	let tag = `OTP-${version}`;
	let checksum =
		"sha256:56412677466b756740fb2dbf4a8019e7c7cc38f01bd30c4cac5210214cafeef6";
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/otp_src_${version}.tar.gz`;
	return std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string;
	dependencies?: {
		flex?: flex.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		perl?: perl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let toolchain = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build: build_,
		dependencies: {
			flex: flexArg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			perl: perlArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let dependencies = [
		flex.build(flexArg),
		ncurses.build(ncursesArg),
		openssl.build(opensslArg),
		perl.build(perlArg),
	];
	let env = std.env.arg(...dependencies, env_);

	return std.autotools.build({
		...std.triple.rotate({ build, host }),
		env,
		sdk,
		source: source_ ?? source(),
	});
});

export default toolchain;
