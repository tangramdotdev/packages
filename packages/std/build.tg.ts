import * as std from "./tangram.tg.ts";

/** Run an executable and return the artifact written to `tg.output`. */
export async function build(
	...args: tg.Args<build.Arg>
): Promise<tg.Artifact | undefined> {
	type Apply = {
		system: tg.Triple;
		checksum: tg.Checksum;
	};
	let { system, checksum } = await tg.Args.apply<build.Arg, Apply>(
		args,
		async (arg) => {
			if (isArgObject(arg)) {
				return {
					system: arg.system,
					checksum: arg.checksum,
				};
			} else {
				return {};
			}
		},
	);

	// Create the executable.
	let executable = await std.wrap(...args);

	// If the system was not set in the args, then get it from the executable or the host.
	let host = await tg.Triple.host();
	if (!system) {
		let executableTriples = await std.file.executableTriples(executable);
		let hostSystem = executableTriples?.includes(host)
			? host
			: executableTriples?.at(0);
		system = tg.Triple.archAndOs(hostSystem ?? host);
	}
	system = system ?? host;

	// Run.
	return tg.Artifact.expect(
		await tg.build({
			host: system,
			executable,
			checksum,
		}),
	);
}

export namespace build {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = std.wrap.ArgObject & {
		system?: tg.Triple;
		unsafe?: boolean;
		checksum?: tg.Checksum;
		network?: boolean;
	};
}

let isArgObject = (arg: unknown): arg is build.ArgObject => {
	return (
		typeof arg === "object" &&
		!(tg.File.is(arg) || tg.Symlink.is(arg) || tg.Template.is(arg))
	);
};
