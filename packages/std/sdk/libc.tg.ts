import * as std from "../tangram.ts";
import kernelHeaders from "./kernel_headers.tg.ts";
import * as glibc from "./libc/glibc.tg.ts";
import * as musl from "./libc/musl.tg.ts";

export type LibCArg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	linuxHeaders?: tg.Directory;
};

/** Obtain the proper standard C library for the given host triple. */
export const libc = async (unresolvedArg: tg.Unresolved<LibCArg>) => {
	const arg = await tg.resolve(unresolvedArg);

	const host = arg.host ?? std.triple.host();
	// Libcs are built for a single target, which is referred to as the host in this context.
	const kind = kindFromTriple(host);
	if (kind === "glibc") {
		const linuxHeaders =
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

const kindFromTriple = (triple: string): LibcKind => {
	const environment = std.triple.environment(triple);
	if (environment === undefined || environment.includes("gnu")) {
		return "glibc";
	} else if (environment === "musl") {
		return "musl";
	} else {
		return tg.unreachable(`Unrecognized environment ${environment}`);
	}
};

/** Get the name of the ld.so binary this libc provides. */
export const interpreterName = (host: string) => {
	const system = std.triple.archAndOs(host);

	const kind = kindFromTriple(host);
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
export const linkerFlags = async (arg: LinkerFlagArg) => {
	const host = arg.host ?? std.triple.host();
	const libPath = tg`${arg.toolchain}/lib`;
	const interpreterPath = tg`${libPath}/${interpreterName(host)}`;
	const flags = tg`-Wl,-dynamic-linker=${interpreterPath} -Wl,-rpath,${libPath}`;
	return flags;
};

/** Construct a sysroot containing the libc and the linux headers. */
export const constructSysroot = async (
	unresolvedArg: tg.Unresolved<LibCArg>,
) => {
	const arg = await tg.resolve(unresolvedArg);
	const host = arg.host ?? std.triple.host();
	const strippedHost = std.triple.stripVersions(host);
	const linuxHeaders =
		arg.linuxHeaders ??
		(await tg.directory({
			include: kernelHeaders({ ...arg, host: strippedHost }),
		}));
	const cLibrary = await libc({ ...arg, linuxHeaders });
	const cLibInclude = await cLibrary
		.get(`${strippedHost}/include`)
		.then(tg.Directory.expect);
	const hostLinuxInclude = linuxHeaders
		.get("include")
		.then(tg.Directory.expect);
	return tg.directory(cLibrary, {
		[`${host}/include`]: tg.directory(cLibInclude, hostLinuxInclude),
	});
};
