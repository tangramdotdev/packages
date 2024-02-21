import * as oci from "./image/oci.tg.ts";
import * as std from "./tangram.tg.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = OciImageArg;

export type OciImageArg = oci.Arg & {
	format: "oci";
};

export type ImageFormat = "oci";

/** Create an image file comprised of Tangram artifacts. */
export let image = async (...args: tg.Args<Arg>): Promise<tg.File> => {
	// Determine format.
	type Apply = {
		format: ImageFormat;
		args: Array<ArgObject>;
	};
	let { format: format_, args: args_ } = await tg.Args.apply<Arg, Apply>(
		args,
		async (arg) => {
			if (
				typeof arg === "string" ||
				tg.Template.is(arg) ||
				tg.File.is(arg) ||
				tg.Symlink.is(arg)
			) {
				return {
					format: "oci",
					args: await tg.Mutation.arrayAppend({ executable: arg }),
				};
			} else if (tg.Directory.is(arg)) {
				return {
					format: "oci",
					args: await tg.Mutation.arrayAppend({ rootFileSystem: arg }),
				};
			} else if (typeof arg === "object") {
				let object: tg.MutationMap<Apply> = {};
				let { format, ...rest } = arg;
				object.format = format;
				object.args = await tg.Mutation.arrayAppend(rest);
				return object;
			} else {
				return tg.unreachable();
			}
		},
	);
	let format = format_ ?? "oci";

	// Build image.
	switch (format) {
		case "oci": {
			return oci.image(...(args_ ?? []));
		}
		default: {
			throw new Error(`unknown image format: ${format}`);
		}
	}
};

export default image;

import * as bootstrap from "./bootstrap.tg.ts";
export let test = tg.target(async () => {
	return testWrappedEntrypoint();
});

export let testWrappedEntrypoint = tg.target(async () => {
	let shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	let script = `echo "hello, world!"`;
	let exe = await std.wrap(script, { interpreter: shell });
	let imageFile = await image(exe);
	return imageFile;
});

export let testBasicRootfs = tg.target(async () => {
	// Test a container with a single file and a shell in it.
	let shell = bootstrap.shell();
	let utils = bootstrap.utils();
	let rootFs = tg.directory(shell, utils, {
		"hello.txt": tg.file("Hello, world!"),
	});
	let imageFile = await image(rootFs, {
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return imageFile;
});

export let testOciBasicEnv = tg.target(async () => {
	let detectedHost = await tg.Triple.host();
	let host = bootstrap.toolchainTriple(detectedHost);
	let utils = await std.utils.env({ host, sdk: { bootstrapMode: true } });
	let basicEnv = await std.env(
		utils,
		{ NAME: "Tangram" },
		{ bootstrapMode: true },
	);
	return basicEnv;
});

export let testBasicEnvImage = tg.target(async () => {
	let basicEnv = await testOciBasicEnv();
	let imageFile = await image(basicEnv, {
		 cmd: ["bash"],
	});
	return imageFile;
});
