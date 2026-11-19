export const publish = async (...args: Array<string>) => {
	const { cwd } = await context();
	await tg.run`tg publish ./all.tg.ts "$@"`
		.executable("sh")
		.args(["--", ...args])
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
