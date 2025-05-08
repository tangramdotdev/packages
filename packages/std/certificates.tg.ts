const metadata = {
	name: "ca-certificates",
	version: "2025-02-25",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = (arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:50a6277ec69113f00c5fd45f09e8b97a4b3e32daa35d3a95ab30137a55386cef";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
};

export default caCertificates;
