export const publish = async (...args: Array<string>) => {
	const { cwd } = await context();

	// Publish every package under packages in one publish, except the demo, sanity, and webdemo packages. A directory is a package if it has a root module, and a file is a package if it is named <package>.tg.<extension>.
	await tg.run`
		set -eu
		paths=
		for entry in packages/*; do
			name=$(basename "$entry")
			case "$name" in
				*.tg.*)
					[ -f "$entry" ] || continue
					package=$(printf '%s' "$name" | sed 's/[.]tg[.].*$//')
					;;
				*)
					[ -d "$entry" ] || continue
					root=
					for module in "$entry"/tangram.*; do
						case "$(basename "$module")" in
							tangram.lock | tangram.*.*) ;;
							*) [ -f "$module" ] && root=1 ;;
						esac
					done
					[ -n "$root" ] || continue
					package=$name
					;;
			esac
			case "$package" in
				demo | sanity | webdemo) continue ;;
			esac
			paths="$paths ./$entry"
		done
		exec tg publish $paths "$@"
	`
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
