let metadata = {
	checksum:
		"sha256:1bf458412568e134a4514f5e170a328d11091e071c7110955c9884ed87972ac9",
	name: "ca-certificates",
	version: "2024-07-02",
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
