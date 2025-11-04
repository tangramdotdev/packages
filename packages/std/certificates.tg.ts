const metadata = {
	name: "ca-certificates",
	version: "2025-11-04",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = (arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:8ac40bdd3d3e151a6b4078d2b2029796e8f843e3f86fbf2adbc4dd9f05e79def";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
};

export default caCertificates;
