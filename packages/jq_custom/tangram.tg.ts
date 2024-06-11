import * as jq from "tg:jq" with { path: "../jq" };
import * as std from "tg:std" with { path: "../std" };

import customVersionPatch from "./custom_version.patch" with { type: "file" };

export let metadata = {
	name: "jq_custom",
};

export let build = tg.target(() => {
	return jq.build({
		autotools: {
			phases: {
				configure: {
					args: tg.Mutation.append(["--disable-docs"]),
				}
			}
		},
		env: {
			CFLAGS: tg.Mutation.suffix("-DCUSTOM_VERSION='\"tangram\"'", " ")
		},
		source: std.patch(jq.source(), customVersionPatch),
	});
});
