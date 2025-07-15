const metadata = {
	name: "ca-certificates",
	version: "2025-07-15",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = (arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:7430e90ee0cdca2d0f02b1ece46fbf255d5d0408111f009638e3b892d6ca089c";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
};

export default caCertificates;
