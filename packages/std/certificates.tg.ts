const metadata = {
	name: "ca-certificates",
	version: "2025-09-09",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = (arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:f290e6acaf904a4121424ca3ebdd70652780707e28e8af999221786b86bb1975";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
};

export default caCertificates;
