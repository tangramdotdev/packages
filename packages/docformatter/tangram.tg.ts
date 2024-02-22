import * as poetry from "tg:poetry" with { path = "../poetry" };
import * as std from "tg:std" with { path = "../std" };

export let metadata = {
	name: "docformatter",
	version: "1.7.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8c4a509f77261c05e093f6268bedd36a2782c0d6ccc01d62d1ddf3a46835aa98";
	let owner = "PyCQA";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		release: true,
		repo,
		tag,
		version,
	});
});

type Arg = {
	source?: tg.Directory;
	host?: tg.Triple.Arg;
	target?: tg.Triple.Arg;
};

export let docformatter = tg.target(async (arg?: Arg) => {
	let lockfile = tg.File.expect(await tg.include("./poetry.lock"));

	return poetry.build({
		source: arg?.source ?? source(),
		lockfile: lockfile,
		host: arg?.host,
		target: arg?.target,
	});
});

export default docformatter;

export let test = tg.target(async () => {
	let directory = docformatter();
	await std.assert.pkg({
		directory,
		binaries: ["docformatter"],
		metadata
	});
	return directory;
});
