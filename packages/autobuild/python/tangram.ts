import * as std from "std" with { path: "../../std" };
import * as python from "python" with { path: "../../python" };
// import * as poetry from "poetry" with { path: "../../poetry" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
	let arg_: python.BuildArg = { build, env: env_, host, source };

	const maybeRequirements = source.tryGet("requirements.txt");
	if (maybeRequirements) {
		if (maybeRequirements instanceof tg.File) {
			arg_ = { ...arg_, requirements: maybeRequirements };
		}
	}

	return python.build(arg_);
});

export default build;

export const plain = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
	const toolchain = await python.toolchain();
	const interpreter = await toolchain.get("bin/python3").then(tg.File.expect);
	return wrapScripts({
		directory: source,
		extension: ".py",
		interpreter,
		env: std.env.arg(
			{
				PYTHONPATH: toolchain,
			},
			env_,
		),
	});
});

// export const poetry = tg.target(async (arg: Arg) => {
// 	const { build, env: envArg, host, source } = arg ?? {};

// 	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
// 	const arg_ = { build, env: env_, host, source };
// 	return poetry.build(arg_);
// });

export const pyproject = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
	const pyprojectToml = await source.get("pyproject.toml").then(tg.File.expect);
	const arg_ = { build, env: env_, host, pyprojectToml, source };
	return python.build(arg_);
});

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(python.toolchain({ ...std.triple.rotate({ build, host }) }));
});
