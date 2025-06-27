import * as std from "std" with { path: "../std" };
import * as bash from "bash" with { path: "../bash" };
import * as bun from "bun" with { path: "../bun" };
import * as coreutils from "coreutils" with { path: "../coreutils" };
import * as nats from "nats-server" with { path: "../nats-server" };
import * as fdb from "foundationdb" with { path: "../foundationdb" };
import * as tangram from "tangram" with { path: "../../../tangram" };
import * as postgresql from "postgresql" with { path: "../postgresql" };
import * as sudo from "sudo" with { path: "../sudo" };

import entrypointScript from "./entrypoint.ts" with { type: "file" };
import testEntrypointScript from "./testEntrypoint.ts" with { type: "file" };

export default async () => {
	// Produce the env.
	const bunArtifact = await bun.self();
	const sudoArtifact = await sudo.build();
	const sudoEtc = await sudoArtifact.get("etc").then(tg.Directory.expect);
	const env = await std.env(
		bunArtifact,
		nats.build(),
		postgresql.build(),
		fdb.build(),
		// tangram.build({ foundationdb: true }),
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
