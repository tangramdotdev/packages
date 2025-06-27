import * as std from "std" with { local: "../std" };
import * as bash from "bash" with { local: "../bash" };
import * as bun from "bun" with { local: "../bun" };
import * as coreutils from "coreutils" with { local: "../coreutils" };
import * as nats from "nats-server" with { local: "../nats-server" };
import * as fdb from "foundationdb" with { local: "../foundationdb" };
import * as tangram from "tangram" with { local: "../../../tangram" };
import * as postgresql from "postgresql" with { local: "../postgresql" };
import * as sudo from "sudo" with { local: "../sudo" };

import entrypointScript from "./entrypoint.ts" with { type: "file" };
import testEntrypointScript from "./testEntrypoint.ts" with { type: "file" };

export type Arg = {
	build?: string;
	host?: string;
};

export const build = async (arg?: Arg) => {
	let host = arg?.host ?? (await std.triple.host());
	let build = arg?.build ?? host;

	// Produce the env.
	const bunArtifact = await bun.self({ host });
	const sudoArtifact = await sudo.build({ build, host });
	const sudoEtc = await sudoArtifact.get("etc").then(tg.Directory.expect);
	const env = await std.env(
		bunArtifact,
		nats.build({ build, host }),
		postgresql.build({ build, host }),
		fdb.build({ build, host }),
		tangram.cloud({ build, host }),
		sudoArtifact,
	);

	// Build the image.
	return await std.image(env, {
		cmd: ["bun", "run", "/script"],
		layers: [
			tg.directory({ etc: sudoEtc }),
			tg.directory({ script: entrypointScript }),
		],
		users: ["root:root:0:0", "postgres"],
	});
};

export default build;

export const cross = async () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});

export const testBun = async () => {
	const bunArtifact = await bun.self();
	const env = await std.env(
		bash.build(),
		bunArtifact,
		coreutils.build(),
		nats.build(),
		{
			NAME: "Tangram",
		},
	);
	return await std.image(env, {
		cmd: ["bun", "run", "/script"],
		layers: [tg.directory({ script: testEntrypointScript })],
	});
};
