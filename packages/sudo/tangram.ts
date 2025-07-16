import * as std from "std" with { local: "../std" };
import * as coreutils from "coreutils" with { local: "../coreutils" };
import * as tzdb from "tzdb" with { local: "../tzdb" };

export const metadata = {
	homepage: "https://www.sudo.ws/",
	license: "https://github.com/sudo-project/sudo/blob/main/LICENSE.md",
	name: "sudo",
	repository: "https://github.com/sudo-project/sudo",
	version: "1.9.17p1",
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	keepPath?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		keepPath = true,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const tzdbArtifact = await tzdb.build({ build, host });
	const tzDir = await tzdbArtifact
		.get("usr/share/zoneinfo")
		.then(tg.Directory.expect);

	const coreutilsArtifact = await coreutils.build({ build, host: build });
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
			"sysconfdir=$OUTPUT/etc",
			"rundir=/tmp/dummy",
			"vardir=/tmp/dummy",
			"DESTDIR=/",
		],
	};
	const phases = { configure, build: buildPhase, install };

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

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
