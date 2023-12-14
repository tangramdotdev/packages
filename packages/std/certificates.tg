let metadata = {
	checksum:
		"sha256:ccbdfc2fe1a0d7bbbb9cc15710271acf1bb1afe4c8f1725fe95c4c7733fcbe5a",
	name: "ca-certificates",
	version: "2023-12-12",
	url: "https://curl.se/ca",
};

type Arg = {
	source?: tg.File;
};

export let caCertificates = tg.target((arg?: Arg) => {
	let { checksum, url, version } = metadata;
	let source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
});

export default caCertificates;
