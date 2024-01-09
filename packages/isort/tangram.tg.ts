import * as poetry from "tg:poetry" with { path: "../poetry" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "isort",
	version: "5.13.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum = "sha256:0f13e665483ca8cfa3d3e1809738ea518f8a66fe5489430273f08368893193e1";
	let owner = "PyCQA";
	let repo = name;
	let tag = version;

	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		version,
	});
});

type Arg = {
	source?: tg.Directory;
	host?: std.Triple.Arg;
	target?: std.Triple.Arg;
};

export let isort = tg.target(async (arg?: Arg) => {
	let sourceArtifact = arg?.source ?? (await source());
	let lockfile = tg.File.expect(await sourceArtifact.get("poetry.lock"));

	return poetry.build({
		source: sourceArtifact,
		lockfile: lockfile,
		host: arg?.host,
		target: arg?.target,
	});
});

export default isort;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await isort(),
		binaries: ["isort"],
		metadata
	});
	return true;
});
