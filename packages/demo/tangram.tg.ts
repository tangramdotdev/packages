import nodejs from "tg:nodejs" with { path: "../nodejs" };
import postgresql from "tg:postgresql" with { path: "../postgresql" };
import ripgrep from "tg:ripgrep" with { path: "../ripgrep" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "demo",
};

export let image = tg.target(() => std.image(env(), { cmd: ["bash"] }));

export let env = tg.target(() => std.env(...packages));

export let executable = tg.target(() => std.wrap(script, { env: env() }));

let packages = [nodejs(), postgresql(), ripgrep()];

export let script = `
	echo "Node.js version: $(node --version)" | tee -a $OUTPUT
	echo "ripgrep version: $(rg --version)" | tee -a $OUTPUT
	echo "PostgreSQL version: $(psql --version)" | tee -a $OUTPUT
`;

export let test = tg.target(() => {
	return std.build(executable());
});
