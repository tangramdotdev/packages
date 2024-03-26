import * as std from "../tangram.tg.ts";
import * as glibc from "./libc/glibc.tg.ts";
import * as musl from "./libc/musl.tg.ts";

type LibCArg = std.sdk.BuildEnvArg & {
	// /** Optionally point to a specific implementation of libcc. Only supported for musl, glibc requires libgcc. */
	// libcc?: tg.File;
	linuxHeaders: tg.Directory;
	target?: string;
};

/** Obtain the proper standard C library for the given host triple. */
export let libc = tg.target(async (arg: LibCArg) => {
	let host = arg.host ?? (await std.triple.host());
	let target = arg.target ?? host;
	// Libcs are built for a single target, which is referred to as the host in this context.
	let kind = kindFromTriple(target);
	if (kind === "glibc") {
		return glibc.default(arg);
	} else if (kind === "musl") {
		return musl.default(arg);
	} else {
		return tg.unimplemented();
	}
});

export default libc;

type LibcKind = "glibc" | "musl";

let kindFromTriple = (triple: string): LibcKind => {
	let environment = std.triple.environment(triple);
	if (environment === undefined || environment.includes("gnu")) {
		return "glibc";
	} else if (environment === "musl") {
		return "musl";
	} else {
		return tg.unimplemented(`Unrecognized environment ${environment}`);
	}
};

/** Get the name of the ld.so binary this libc provides. */
export let interpreterName = (host: string) => {
	let system = std.triple.archAndOs(host);

	let kind = kindFromTriple(host);
	if (kind === "glibc") {
		return glibc.interpreterName(system);
	} else if (kind === "musl") {
		return musl.interpreterName(system);
	} else {
		return tg.unreachable();
	}
};

type LinkerFlagArg = {
	toolchain: tg.Directory;
	host?: string;
};

/** Get a template to pass linker flags that point to this libc in the given toolchain directory for the interpreter and rpath. */
export let linkerFlags = async (arg: LinkerFlagArg) => {
	let host = arg.host ?? (await std.triple.host());
	let libPath = tg`${arg.toolchain}/lib`;
	let interpreterPath = tg`${libPath}/${interpreterName(host)}`;
	let flags = tg`-Wl,-dynamic-linker=${interpreterPath} -Wl,-rpath,${libPath}`;
	return flags;
};

/** Construct a sysroot containing the libc and the linux headers. */
export let constructSysroot = async (arg: LibCArg) => {
	let host = arg.host ?? (await std.triple.host());
	let cLibrary = await libc(arg);
	let cLibInclude = tg.Directory.expect(await cLibrary.get(`${host}/include`));
	let hostLinuxInclude = tg.Directory.expect(
		await arg.linuxHeaders.get("include"),
	);
	return tg.directory(cLibrary, {
		[`${host}/include`]: tg.directory(cLibInclude, hostLinuxInclude),
	});
};
