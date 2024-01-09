import nodejs from "tg:nodejs" with { path: "../nodejs" };
import postgresql from "tg:postgresql" with { path: "../postgresql" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "demo",
};

export let container = tg.target(() => std.container(executable()));

export let env = tg.target(() => std.env(...packages));

export let executable = tg.target(async () =>
	std.wrap(script, { env: env() }),
);

let packages = [postgresql(), nodejs()];

export let script = `
	echo "Node.js version: $(node --version)" | tee $OUTPUT
	echo "PostgreSQL version: $(psql --version)" | tee -a $OUTPUT
`;

export let test = tg.target(() => {
	return std.build(executable());
});
