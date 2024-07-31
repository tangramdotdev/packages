import * as std from "../tangram.tg.ts";
import kernelHeaders from "./kernel_headers.tg.ts";
import * as glibc from "./libc/glibc.tg.ts";
import * as musl from "./libc/musl.tg.ts";

export type LibCArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	linuxHeaders?: tg.Directory;
};

/** Obtain the proper standard C library for the given host triple. */
export let libc = async (unresolvedArg: tg.Unresolved<LibCArg>) => {
	let arg = await tg.resolve(unresolvedArg);

	let host = arg.host ?? (await std.triple.host());
	// Libcs are built for a single target, which is referred to as the host in this context.
	let kind = kindFromTriple(host);
	if (kind === "glibc") {
		let linuxHeaders =
			arg.linuxHeaders ??
			tg.directory({
				include: kernelHeaders({
					...arg,
					host: std.triple.stripVersions(host),
				}),
			});
		return glibc.build({ ...arg, linuxHeaders });
	} else if (kind === "musl") {
		return musl.build(arg);
	} else {
		return tg.unreachable();
	}
};

export default libc;

type LibcKind = "glibc" | "musl";

let kindFromTriple = (triple: string): LibcKind => {
	let environment = std.triple.environment(triple);
	if (environment === undefined || environment.includes("gnu")) {
		return "glibc";
	} else if (environment === "musl") {
		return "musl";
	} else {
		return tg.unreachable(`Unrecognized environment ${environment}`);
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
export let constructSysroot = async (unresolvedArg: tg.Unresolved<LibCArg>) => {
	let arg = await tg.resolve(unresolvedArg);
	let host = arg.host ?? (await std.triple.host());
	let strippedHost = std.triple.stripVersions(host);
	let linuxHeaders =
		arg.linuxHeaders ??
		(await tg.directory({
			include: kernelHeaders({ ...arg, host: strippedHost }),
		}));
	let cLibrary = await libc({ ...arg, linuxHeaders });
	let cLibInclude = await cLibrary
		.get(`${strippedHost}/include`)
		.then(tg.Directory.expect);
	let hostLinuxInclude = linuxHeaders.get("include").then(tg.Directory.expect);
	return tg.directory(cLibrary, {
		[`${host}/include`]: tg.directory(cLibInclude, hostLinuxInclude),
	});
};
