// import * as std from "../tangram.tg.ts";

// export let ncurses = async (arg?: std.sdk.BuildEnvArg) => {
// 	// FIXME - the pkg-config files arent working properly, the fixup ln step fails.

// 	let configure = {
// 		args: [
// 			"--with-shared",
// 			"--with-cxx-shared",
// 			"--enable-pc-files",
// 			"--without-debug",
// 			"--without-ada",
// 		],
// 	};

// 	let source = std.download.fromMetadata(metadata);

// 	let result = std.phases.autotools.build({
// 		...arg,
// 		phases: { configure },
// 		source,
// 	});

// 	// Perform some post-processing in the output directory to handle wide-character libraries.
// 	// TODO - do this with tangram instead of a shell script.
// 	// let fixupScript = tg`
// 	// 	cp -R ${result}/* $OUTPUT
// 	// 	for lib in ncurses form panel menu ; do
// 	// 	rm -vf                     $OUTPUT/lib/lib\${lib}.so
// 	// 	echo "INPUT(-l\${lib}w)" > $OUTPUT/lib/lib\${lib}.so
// 	// 	ln -sfv \${lib}w.pc        $OUTPUT/lib/pkgconfig/\${lib}.pc || true
// 	// 	done
// 	// 	rm -vf                     $OUTPUT/lib/libcursesw.so
// 	// 	echo "INPUT(-lncursesw)" > $OUTPUT/lib/libcursesw.so
// 	// 	ln -sfv libncurses.so      $OUTPUT/lib/libcurses.so
// 	// `;

// 	return result;
// };

// export default ncurses;

// export let source = () => {
// 	return std.download.fromMetadata(metadata);
// };

// export let metadata = {
// 	checksum:
// 		"sha256:6931283d9ac87c5073f30b6290c4c75f21632bb4fc3603ac8100812bed248159",
// 	name: "ncurses",
// 	url: "gnu",
// 	version: "6.4",
// };
