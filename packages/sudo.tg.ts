import * as std from "std" with { local: "./std" };
import * as coreutils from "coreutils" with { local: "./coreutils.tg.ts" };
import * as tzdb from "tzdb" with { local: "./tzdb.tg.ts" };

const deps = std.deps({
	coreutils: { build: coreutils.build, kind: "buildtime" },
	tzdb: tzdb.build,
});

export const metadata = {
	homepage: "https://www.sudo.ws/",
	license: "https://github.com/sudo-project/sudo/blob/main/LICENSE.md",
	name: "sudo",
	repository: "https://github.com/sudo-project/sudo",
	version: "1.9.17p1",
	tag: "sudo/1.9.17p1",
};

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ff607ea717072197738a78f778692cd6df9a7e3e404565f51de063ca27455d32";
	const owner = "sudo-project";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = std.autotools.Arg &
	std.deps.Arg<typeof deps> & {
		keepPath?: boolean;
	};

export const build = async (...args: std.Args<Arg>) => {
	// Extract custom options first.
	const customOptions = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const keepPath = customOptions.keepPath ?? true;
	const build_ = customOptions.build ?? customOptions.host ?? std.triple.host();
	const host = customOptions.host ?? std.triple.host();

	const { tzdb: tzdbArtifact, coreutils: coreutilsArtifact } =
		await std.deps.artifacts(deps, { build: build_, host });
	tg.assert(tzdbArtifact !== undefined);
	tg.assert(coreutilsArtifact !== undefined);

	const tzDir = await tzdbArtifact
		.get("usr/share/zoneinfo")
		.then(tg.Directory.expect);

	const configure = {
		body: {
			args: [
				"--enable-package-building",
				"--enable-static-sudoers",
				"--enable-tempfiles.d=no",
				"--with-env-editor",
				"--with-rundir=/tmp/sudo",
				tg`--with-tzdir=${tzDir}`,
			],
		},
		post: tg`
			cat >> pathnames.h <<'EOF'
				#undef _PATH_MV
				#define _PATH_MV "${coreutilsArtifact}/bin/mv"
			EOF
		`,
	};

	const buildPhase = {
		args: ["install_uid=$(id- u)", "install_gid=$(id -g)"],
	};
	const install = {
		args: [
			"sudoers_uid=$(id -u)",
			"sudoers_gid=$(id -g)",
			tg`sysconfdir=${tg.output}/etc`,
			"rundir=/tmp/dummy",
			"vardir=/tmp/dummy",
			"DESTDIR=/",
		],
	};
	const phases = { configure, build: buildPhase, install };

	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			phases,
		},
		...args,
	);

	let output = await std.autotools.build(arg);

	// Add wheel and path configuration.
	if (keepPath) {
		output = await tg.directory(output, {
			["etc/sudoers.d"]: {
				tangram: `Defaults env_keep += "PATH"\nDefaults !secure_path\n`,
			},
		});
	}

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};

export const image = async () => {
	const sudoArtifact = await build();
	const sudoEtc = await sudoArtifact.get("etc").then(tg.Directory.expect);
	const env = std.env(sudoArtifact);
	const script = "whoami && sudo -u tangram whoami";
	const image = std.image(env, {
		cmd: ["bash", "-c", script],
		layers: [tg.directory({ etc: sudoEtc })],
		users: ["root:root:0:0", "tangram"],
	});
	return image;
};
