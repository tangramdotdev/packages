import zlib from "tg:zlib" with { path: "../zlib" };
// import curl from "tangram:../curl";
import libarchive from "tg:libarchive" with { path: "../libarchive" };
// import openssl from "tangram:../openssl"; // FIXME - this transitive dep should be automatic.
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "elfutils",
	version: "0.189",
	checksum:
		"sha256:39bd8f1a338e2b7cd4abc3ff11a0eddc6e690f69578a57478d8179b4148708c8",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:39bd8f1a338e2b7cd4abc3ff11a0eddc6e690f69578a57478d8179b4148708c8";
	let unpackFormat = ".tar.bz2" as const;
	let url = `https://sourceware.org/elfutils/ftp/${version}/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let elfutils = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await std.triple.host(host_);
	let build = build_ ?? host;

	let configure = {
		args: [
			"--enable-deterministic-archives",
			"--program-prefix=eu-",
			"--disable-nls",
			"--disable-rpath",
			"--enable-install-elfh",
			"--without-libiconv-prefix",
			"--without-libintl-prefix",
			// FIXME - bzlib tries to pull from utils, which just has a staticlib.
			"--without-bzlib",
			// FIXME - figure out how to get debuginfod to build
			"--disable-debuginfod",
			"--enable-libdebuginfod=dummy",
		],
	};

	if (!std.triple.eq(build, host)) {
		configure.args.push(`--host=${std.triple.toString(host)}`);
	}

	let phases = { configure };

	let env = [
		zlib(arg),
		{ CFLAGS: tg.Mutation.templateAppend("-Wno-format-nonliteral -lz", " ") },
		env_,
	];

	let result = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
});

export default elfutils;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await elfutils(),
		// FIXME - wrap each binary with the result's own lib dir in libraryPaths, see curl.
		// binaries: [
		// 	"eu-addr2line",
		// 	"eu-ar",
		// 	"eu-elfcmp",
		// 	"eu-elfcompress",
		// 	"eu-elflint",
		// 	"eu-findtextrel",
		// 	"eu-make-debug-archive",
		// 	"eu-nm",
		// 	"eu-objdump",
		// 	"eu-ranlib",
		// 	"eu-readelf",
		// 	"eu-size",
		// 	"eu-stack",
		// 	"eu-strings",
		// 	"eu-strip",
		// 	"eu-unstrip",
		// ],
		// FIXME - Failed to create tangram instance.: Other { message: "Resource temporarily unavailable", source: None }'
		// headers: [
		// 	"dwarf.h",
		// 	"elf.h",
		// 	"gelf.h",
		// 	"libelf.h",
		// 	"nlist.h",
		// 	"elfutils/elf-knowledge.h",
		// 	"elfutils/known-dwarf.h",
		// 	"elfutils/libasm.h",
		// 	"elfutils/libdw.h",
		// 	"elfutils/libdw.h",
		// 	"elfutils/libdwfl.h",
		// 	"elfutils/version.h",
		// ],
		libs: ["elf", "dw", "asm"],
	});
	return true;
});
