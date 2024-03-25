export type Components = {
	arch: string;
	vendor?: string;
	os: string;
	osVersion?: string;
	environment?: string;
	environmentVersion?: string;
};

export type Arg = string | Partial<Components>;

/** Construct a new triple string from a list of existing triples or component objects. Later arguments override fields from previous arguments. */
export let create = (...args: Array<Arg>): string => {
	return tg.unimplemented();
};

export let assert = (s: string): void => {
	components(s);
};

export let archAndOs = (s: string): string => {
	let orig = components(s);
	return orig.arch + "-" + orig.os;
};

export let tryArchAndOs = (s: string): string | undefined => {
	let orig = tryComponents(s);
	if (!orig) {
		return undefined;
	}
	return orig.arch + "-" + orig.os;
};

export let host = async (): Promise<string> => {
	return tg.unimplemented();
};

export let arch = (s: string): string => {
	return components(s).arch;
};

export let tryArch = (s: string): string | undefined => {
	return tryComponents(s)?.arch;
};

export let withArch = (s: string, arch: string): string => {
	let orig = components(s);
	orig.arch = arch;
	return fromComponents(orig);
};

export let vendor = (s: string): string => {
	let ret = components(s).vendor;
	if (!ret) {
		throw new Error("vendor is not defined");
	}
	return ret;
};

export let tryVendor = (s: string): string | undefined => {
	return tryComponents(s)?.vendor;
};

export let os = (s: string): string => {
	return components(s).os;
};

export let tryOs = (s: string): string | undefined => {
	return tryComponents(s)?.os;
};

export let osVersion = (s: string): string => {
	let ret = components(s).osVersion;
	if (!ret) {
		throw new Error("osVersion is not defined");
	}
	return ret;
};

export let tryOsVersion = (s: string): string | undefined => {
	return tryComponents(s)?.osVersion;
};

export let environment = (s: string): string => {
	let ret = components(s).environment;
	if (!ret) {
		throw new Error("enviroment is not defined");
	}
	return ret;
};

export let tryEnvironment = (s: string): string | undefined => {
	return tryComponents(s)?.environment;
};

export let environmentVersion = (s: string): string => {
	let ret = components(s).environmentVersion;
	if (!ret) {
		throw new Error("enviromentVersion is not defined");
	}
	return ret;
};

export let tryEnvironmentVersion = (s: string): string | undefined => {
	return tryComponents(s)?.environmentVersion;
};

export let components = (s: string): Components => {
	// TODO - is it worth it to keep a global map of seen strings -> components, to avoid repeated parsing? It's not worth a target, but might be worth this.

	let ret = tryComponents(s);
	if (!ret) {
		throw new Error(`unable to parse triple components from string ${s}`);
	}
	return ret;
};

export let tryComponents = (s: string): Components | undefined => {
	return tg.unimplemented();
};

export let fromComponents = (c: Components) => {
	// TODO Should this normalize?
	return tg.unimplemented();
};

export let normalize = (s: string): string => {
	//return fromComponents(components(s));
	return tg.unimplemented();
};

export let rotate = (arg: {
	build?: string;
	host?: string;
}): { host: string; target: string } => {
	return tg.unimplemented();
};
