import * as attr from "tg:attr" with { path: "../attr" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git",
	license: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git/tree/License",
	name: "libcap",
	repository: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git",
	version: "2.24",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let checksum =
		"sha256:cee4568f78dc851d726fc93f25f4ed91cc223b1fe8259daa4a77158d174e6c65";
	let base = `https://www.kernel.org/pub/linux/libs/security/linux-privs/libcap2`;
	return await std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		attr?: attr.Arg;
		perl?: perl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { attr: attrArg = {}, perl: perlArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let install = tg.Mutation.set(`
		mkdir -p $OUTPUT/bin $OUTPUT/lib/pkgconfig
		bins="capsh getcap setcap getpcaps"
		for bin in $bins; do
			cp "progs/$bin" "$OUTPUT/bin"
		done
		cp -R libcap/include "$OUTPUT"
		cp libcap/libcap.pc "$OUTPUT/lib/pkgconfig"
		cp libcap/libcap.a "$OUTPUT/lib"
		cp libcap/libcap.so.${metadata.version} "$OUTPUT/lib"
		cd $OUTPUT/lib
		ln -s libcap.so.${metadata.version} libcap.so.2
		ln -s libcap.so.2 libcap.so
	`);
	let phases = { configure: tg.Mutation.unset(), install };

	let attrArtifact = await attr.build({ build, env: env_, host, sdk }, attrArg);
	let dependencies = [
		attrArtifact,
		perl.build({ build, env: env_, host, sdk }, perlArg),
	];
	let env = std.env.arg(
		...dependencies,
		{
			LDFLAGS: tg.Mutation.prefix(`-L${attrArtifact}/lib`, " "),
		},
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("usage:"),
		};
	};
	let binaries = ["capsh", "getcap", "setcap", "getpcaps"].map(binTest);
	await std.assert.pkg({
		buildFunction: build,
		binaries,
		libraries: ["cap"],
		metadata,
	});
	return true;
});
