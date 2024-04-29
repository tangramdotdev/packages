import * as std from "./tangram.tg.ts";

/** Run an executable and return the artifact written to `tg.output`. */
export async function build(
	...args: tg.Args<build.Arg>
): Promise<tg.Artifact | undefined> {
	type Apply = {
		checksum?: tg.Checksum;
		host?: string;
	};
	let { checksum, host } = await tg.Args.apply<build.Arg, Apply>(
		args,
		async (arg) => {
			if (
				typeof arg === "string" ||
				tg.Template.is(arg) ||
				tg.File.is(arg) ||
				tg.Symlink.is(arg)
			) {
				return {};
			} else {
				let object: tg.MaybeMutationMap<Apply> = {};
				if (arg.checksum !== undefined) {
					object.checksum = arg.checksum;
				}
				if (arg.host !== undefined) {
					object.host = arg.host;
				}
				return object;
			}
		},
	);

	// Create the executable.
	let executable = await std.wrap(...args);

	// If no host was specified, determine an approriate host from the executable.
	if (host === undefined) {
		let detectedHost = await std.triple.host();
		let executableTriples = await std.file.executableTriples(executable);
		host = executableTriples?.includes(detectedHost)
			? detectedHost
			: executableTriples?.at(0) ?? detectedHost;
	}
	host = std.triple.archAndOs(host);

	// Run.
	return tg.Artifact.expect(
		await tg.build({
			checksum,
			executable,
			host,
		}),
	);
}

export namespace build {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = std.wrap.ArgObject & {
		/** An optional checksum to enable network access. Provide the checksu of the result, or the string "unsafe" to accept any result. */
		checksum?: tg.Checksum;
		/** The machine this build should run on. If omitted, will autodetect an appropriate host. */
		host?: string;
	};
}
