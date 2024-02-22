import * as python from "tg:python" with { path = "../python" };
import * as std from "tg:std" with { path = "../std" };

export let metadata = {
	name: "httpie",
	version: "3.2.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:01b4407202fac3cc68c73a8ff1f4a81a759d9575fabfad855772c29365fe18e6";
	let owner = name;
	let repo = name;
	let tag = version;
	// let url = `https://github.com/httpie/cli/archive/refs/tags/3.2.2.tar.gz`;

	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		version
	});
});

type Arg = {
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	python?: tg.MaybeNestedArray<python.Arg>;
	host?: tg.Triple.Arg;
	source?: tg.Directory;
};

export let requirements = tg.target(async () => {
	let file = await tg.include("requirements.txt");
	return tg.File.expect(file);
});

export let pyprojectToml = tg.target(async () => {
	let file = await tg.include("pyproject.toml");
	return tg.File.expect(file);
});

export let httpie = tg.target(async (arg?: Arg) => {
	let sourceArtifact = arg?.source ?? (await source());
	let main = await sourceArtifact.get("httpie/__main__.py");

	let build = python.build(
		{
			build: arg?.build,
			source: sourceArtifact,
			pyprojectToml: pyprojectToml(),
			python: { requirements: requirements() },
			host: arg?.host,
		},
		arg?.python ?? [],
	);

	return build;
});

export default httpie;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await httpie(),
		binaries: ["http", "https", "httpie"],
		metadata
	});
	return true;
});
