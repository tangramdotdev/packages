export const check = async (...args: Array<string>) => {
	await packages("check", args);
};

export const format = async (...args: Array<string>) => {
	await packages("format", args);
};

export const publish = async (...args: Array<string>) => {
	await packages("publish", args);
};

export const test = async (...args: Array<string>) => {
	await packages("test", args);
};

const packages = async (action: string, args: Array<string>) => {
	const { cwd } = await context();
	await tg.run`nu scripts/packages.nu "$@"`
		.executable("sh")
		.args(["--", action, ...args])
		.cwd(cwd);
};

const context = async () => {
	let root = tg.process.cwd;
	while (
		!(await tg.host.exists(tg.path.join(root, "packages/std/tangram.ts")))
	) {
		const parent = tg.path.parent(root);
		if (!parent || parent === root) {
			throw new Error("run repository scripts from within the repository");
		}
		root = parent;
	}
	return { cwd: root };
};
