import * as attr from "attr" with { path: "../attr" };
import * as bash from "bash" with { path: "../bash" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git/tree/License",
	name: "libcap",
	repository: "https://git.kernel.org/pub/scm/libs/libcap/libcap.git",
	version: "2.73",
	provides: {
		binaries: ["capsh", "getcap", "setcap", "getpcaps"],
		libraries: ["cap"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:6405f6089cf4cdd8c271540cd990654d78dd0b1989b2d9bda20f933a75a795a5";
	const base = `https://www.kernel.org/pub/linux/libs/security/linux-privs/libcap2`;
	let source = await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	// Wrap the mkcapshdoc.sh script to use bash, to avoid the shebang failing to find /bin/bash.
	const scriptSubpath = "progs/mkcapshdoc.sh";
	const mkCapShDoc = await source.get(scriptSubpath).then(tg.File.expect);
	const wrappedMkCapShDoc = await bash.wrapScript(
		mkCapShDoc,
		await std.triple.host(),
	);
	source = await tg.directory(source, {
		[scriptSubpath]: wrappedMkCapShDoc,
	});

	return source;
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		attr?: attr.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { attr: attrArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const install = {
		command: tg.Mutation.set(`
		set -x
		mkdir -p $OUTPUT/bin $OUTPUT/lib/pkgconfig
		bins="capsh getcap setcap getpcaps"
		for bin in $bins; do
			install -m 0755 "progs/$bin" "$OUTPUT/bin"
		done
		install -d "$OUTPUT/include/sys" "$OUTPUT/include/uapi/linux"
		install -m 0644 libcap/include/sys/*.h "$OUTPUT/include/sys"
		install -m 0644 libcap/include/uapi/linux/*.h "$OUTPUT/include/uapi/linux"
		install -m 0644 libcap/libcap.pc "$OUTPUT/lib/pkgconfig"
		install -m 0644 libcap/libcap.a "$OUTPUT/lib"
		install -m 0755 libcap/libcap.so.${metadata.version} "$OUTPUT/lib"
		cd $OUTPUT/lib
		ln -s libcap.so.${metadata.version} libcap.so.2
		ln -s libcap.so.2 libcap.so
	`),
		args: tg.Mutation.unset(),
	};
	const phases = { configure: tg.Mutation.unset(), install };

	const attrArtifact = await attr.build(
		{ build, env: env_, host, sdk },
		attrArg,
	);
	const dependencies = [attrArtifact];
	const env = std.env.arg(...dependencies, env_);

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
};

export default build;

export const test = async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["-h"],
			testPredicate: (stdout: string) => stdout.includes("usage:"),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map(hasUsage),
	};
	return await std.assert.pkg(build, spec);
};
