const metadata = {
	name: "ca-certificates",
	version: "2025-12-02",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = (arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:f1407d974c5ed87d544bd931a278232e13925177e239fca370619aba63c757b4";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
};

export default caCertificates;
