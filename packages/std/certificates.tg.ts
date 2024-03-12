let metadata = {
	checksum:
		"sha256:1794c1d4f7055b7d02c2170337b61b48a2ef6c90d77e95444fd2596f4cac609f",
	name: "ca-certificates",
	version: "2024-03-11",
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
