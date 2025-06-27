import * as std from "std" with { local: "../std" };
import * as bash from "bash" with { local: "../bash.tg.ts" };
import * as bind from "bind" with { local: "../bind.tg.ts" };
import * as nats from "nats-server" with { local: "../nats-server.tg.ts" };
import * as natscli from "natscli" with { local: "../natscli.tg.ts" };
import * as nushell from "nushell" with { local: "../nushell.tg.ts" };
import * as tangram from "tangram" with { local: "../../../tangram" };
import * as postgresql from "postgresql" with { local: "../postgresql" };
import * as sudo from "sudo" with { local: "../sudo.tg.ts" };
import * as scylladb from "scylladb" with { local: "../scylladb.tg.ts" };

import entrypointScript from "./entrypoint.nu" with { type: "file" };

export type Arg = {
	build?: string;
	host?: string;
};

export const build = async (arg?: Arg) => {
	let host = arg?.host ?? std.triple.host();
	let build = arg?.build ?? host;

	// Produce the env.
	const sudoArtifact = await sudo.build({ build, host });
	const sudoEtc = await sudoArtifact.get("etc").then(tg.Directory.expect);
	const env = await std.env(
		bash.build({ build, host }),
		bind.build({ build, host }),
		nats.build({ build, host }),
		natscli.build({ build, host }),
		nushell.build({ build, host }),
		postgresql.build({ build, host }),
		tangram.cloud({ build, host }),
		sudoArtifact,
		scylladb.build({ host }),
	);

	// Build the image.
	return await std.image(env, {
		cmd: ["nu", "/script"],
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
		build: "x86_64-unknown-linux-gnu",
		host: "aarch64-unknown-linux-gnu",
	});
