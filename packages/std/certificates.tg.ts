const metadata = {
	name: "ca-certificates",
	version: "2024-09-24",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = tg.target((arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:189d3cf6d103185fba06d76c1af915263c6d42225481a1759e853b33ac857540";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
});

export default caCertificates;
