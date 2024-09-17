export type Components = {
	arch: string;
	vendor?: string;
	os: string;
	osVersion?: string | undefined;
	environment?: string;
	environmentVersion?: string | undefined;
};

export type Arg = string | Partial<Components>;

/** Construct a new triple string from a list of existing triples or component objects. Later arguments override fields from previous arguments. */
export const create = (...args: Array<Arg>): string => {
	let c: Partial<Components> = {};
	for (const arg of args) {
		if (typeof arg === "string") {
			const next = components(arg);
			c = { ...c, ...next };
		} else {
			c = { ...c, ...arg };
		}
	}
	tg.assert(c.arch);
	tg.assert(c.os);
	return fromComponents(c as Components);
};

/** Assert a string represents a valid triple. */
export const assert = (s: string): void => {
	components(s);
};

/** Produce a triple string retaining only the arch and os fields from an incoming triple. Throws if unable to parse the input. */
export const archAndOs = (s: string): string => {
	const orig = components(s);
	return orig.arch + "-" + orig.os;
};

/** Produce a triple string retaining only the arch and os fields from an incoming triple. Returns `undefined` if unable to parse the input. */
export const tryArchAndOs = (s: string): string | undefined => {
	const orig = tryComponents(s);
	if (!orig) {
		return undefined;
	}
	return orig.arch + "-" + orig.os;
};

/** Retrieve the configured host for the current running target. */
export const host = async (): Promise<string> => {
	return (await tg.Target.current.env())["TANGRAM_HOST"] as string;
};

/** Retrieve the arch field from a triple string. Throws if unable to parse the input. */
export const arch = (s: string): string => {
	return components(s).arch;
};

/** Retrieve the arch field from a triple string. Returns `undefined` if unable to parse the input. */
export const tryArch = (s: string): string | undefined => {
	return tryComponents(s)?.arch;
};

/** Retrieve the vendor field from a triple string. Throws if unable to parse the input, returns `undefined` if no vendor is set. */
export const vendor = (s: string): string | undefined => {
	return components(s).vendor;
};

/** Retrieve the vendor field from a triple string. Returns `undefined` if unable to parse the input or if no vendor is set. */
export const tryVendor = (s: string): string | undefined => {
	return tryComponents(s)?.vendor;
};

/** Retrieve the os field from a triple string. Throws if unable to parse the input. */
export const os = (s: string): string => {
	return components(s).os;
};

/** Retrieve the os field from a triple string. Returns `undefined` if unable to parse the input. */
export const tryOs = (s: string): string | undefined => {
	return tryComponents(s)?.os;
};

/** Retrieve the osVersion field from a triple string. Throws if unable to parse the input, returns `undefined` if the os version is not defined. */
export const osVersion = (s: string): string | undefined => {
	return components(s).osVersion;
};

/** Retrieve the osVersion field from a triple string. Returns `undefined` if unable to parse the input or the os version is not defined. */
export const tryOsVersion = (s: string): string | undefined => {
	return tryComponents(s)?.osVersion;
};

/** Retrieve the environment field from a triple string. Throws if unable to parse the input, returns `undefined` if no environment is set. */
export const environment = (s: string): string | undefined => {
	return components(s).environment;
};

/** Retrieve the environment field from a triple string. Returns `undefined` if unable to parse the input or the environment is not defined. */
export const tryEnvironment = (s: string): string | undefined => {
	return tryComponents(s)?.environment;
};

/** Retrieve the environmentVersion field from a triple string. Throws if unable to parse the input, returns undefined if the environment version is not defined. */
export const environmentVersion = (s: string): string | undefined => {
	return components(s).environmentVersion;
};

/** Retrieve the environmentVersion field from a triple string. Returns `undefined` if unable to parse the input or the environment version is not defined. */
export const tryEnvironmentVersion = (s: string): string | undefined => {
	return tryComponents(s)?.environmentVersion;
};

/** Parse the fields of a triple stirng into individual components. Throws if unable to parse the input. */
export const components = (s: string): Components => {
	const ret = tryComponents(s);
	if (!ret) {
		throw new Error(`unable to parse triple components from string ${s}`);
	}
	return ret;
};

/** Parse the fields of a triple stirng into individual components. Returns `undefined` if unable to parse the input. */
export const tryComponents = (s: string): Components | undefined => {
	const parts = s.split("-");

	// Reject if the triple has too few or too many parts.
	if (parts.length < 2 || parts.length > 5) {
		return undefined;
	}

	// The first part is always the architecture.
	const arch = parts[0];
	tg.assert(arch);

	// If the triple has only two parts, the second part is the os. Ensure it's valid.
	if (parts.length === 2) {
		const next = parts[1];
		tg.assert(next);
		const os = parseOs(next);
		if (os) {
			return { ...os, arch };
		}
		return undefined;
	}

	// If the triple has three parts, the second part is either the vendor or the os.
	if (parts.length === 3) {
		const next = parts[1];
		tg.assert(next);
		const os = parseOs(next);
		if (os) {
			// The third part is the environment. Validate.
			const envField = parts[2];
			tg.assert(envField);
			const env = parseEnv(envField);
			if (env) {
				return { ...os, ...env, arch };
			}
		} else {
			// The second part is the vendor. Validate the third part for the os.
			const vendor = next;
			const osField = parts[2];
			tg.assert(osField);
			const os = parseOs(osField);
			if (os) {
				return { ...os, vendor, arch };
			}
		}
		return undefined;
	}

	// Otherwise, we have exactly 4 parts. The second part is the vendor, the third part is the os, and the fourth part is the environment.
	const vendor = parts[1];
	tg.assert(vendor);
	const osField = parts[2];
	tg.assert(osField);
	const os = parseOs(osField);
	if (!os) {
		return undefined;
	}
	const envField = parts[3];
	tg.assert(envField);
	const env = parseEnv(envField);
	if (!env) {
		return undefined;
	}
	return { ...os, ...env, vendor, arch };
};

/** Produce a triple string from a set of components. */
export const fromComponents = (c: Components) => {
	let ret = c.arch;
	if (c.vendor) {
		ret += "-" + c.vendor;
	}
	ret += "-" + c.os;
	if (c.osVersion) {
		ret += c.osVersion;
	}
	if (c.environment) {
		ret += "-" + c.environment;
	}
	if (c.environmentVersion) {
		if (!c.environment) {
			throw new Error("environmentVersion is defined but environment is not");
		}
		ret += c.environmentVersion;
	}
	return ret;
};

/** Normalize a triple string to the form ARCH-VENDOR-OS or ARCH-VENDOR-OS-ENVIRONMENT, filling in `unknown` for missing fields as necessary. */
export const normalize = (s: string): string => {
	const c = components(s);
	if (!c.vendor) {
		c.vendor = "unknown";
	}
	return fromComponents(c);
};

/** Given optional `build` and `host` machines for a build, return the concrete `host` and `target` for producing the correct build toolchain by "rotating" the inputs: build->host, host->target. */
export const rotate = async (arg: {
	build?: string | undefined;
	host?: string | undefined;
}): Promise<{ host: string; target: string }> => {
	const host =
		arg.host ?? ((await tg.Target.current.env())["TANGRAM_HOST"] as string);
	const build = arg.build ?? host;
	return { host: build, target: host };
};

/** Strip the version components if present. */
export const stripVersions = (s: string) => {
	const c = components(s);
	c.osVersion = undefined;
	c.environmentVersion = undefined;
	return fromComponents(c);
};

const envs = ["gnu", "musl"];
const oss = ["linux", "darwin"];

/** Check if a string contains a known OS and optional version. Return undefined if not. */
const parseOs = (
	s: string,
): { os: string; osVersion?: string | undefined } | undefined => {
	for (const knownOs of oss) {
		if (s.startsWith(knownOs)) {
			// If we found it, check if there's an os version.
			const os = knownOs;
			const osVersion = s.slice(knownOs.length);
			return {
				os,
				osVersion: osVersion.length > 0 ? osVersion : undefined,
			};
		}
	}
	return undefined;
};

/** Check if a string contains a known environment and optional version. Return undefined if not. */
const parseEnv = (
	s: string,
):
	| { environment: string; environmentVersion?: string | undefined }
	| undefined => {
	for (const knownEnv of envs) {
		if (s.startsWith(knownEnv)) {
			// If we found it, check if there's an environment version.
			const environment = knownEnv;
			const environmentVersion = s.slice(knownEnv.length);
			return {
				environment,
				environmentVersion:
					environmentVersion.length > 0 ? environmentVersion : undefined,
			};
		}
	}
	return undefined;
};

export const test = tg.target(() => {
	const t0 = "aarch64-linux";
	const c0 = components(t0);
	tg.assert(c0.arch === "aarch64");
	tg.assert(c0.os === "linux");
	tg.assert(c0.vendor === undefined);
	tg.assert(c0.osVersion === undefined);
	tg.assert(c0.environment === undefined);
	tg.assert(c0.environmentVersion === undefined);

	const t1 = "x86_64-linux-gnu";
	const c1 = components(t1);
	tg.assert(c1.arch === "x86_64");
	tg.assert(c1.os === "linux");
	tg.assert(c1.vendor === undefined);
	tg.assert(c1.osVersion === undefined);
	tg.assert(c1.environment === "gnu");
	tg.assert(c1.environmentVersion === undefined);

	const t2 = "aarch64-linux-musl";
	const c2 = components(t2);
	tg.assert(c2.arch === "aarch64");
	tg.assert(c2.os === "linux");
	tg.assert(c2.vendor === undefined);
	tg.assert(c2.osVersion === undefined);
	tg.assert(c2.environment === "musl");
	tg.assert(c2.environmentVersion === undefined);

	const t3 = "arm64-apple-darwin23.4.0";
	const c3 = components(t3);
	tg.assert(c3.arch === "arm64");
	tg.assert(c3.os === "darwin");
	tg.assert(c3.vendor === "apple");
	tg.assert(c3.osVersion === "23.4.0");
	tg.assert(c3.environment === undefined);
	tg.assert(c3.environmentVersion === undefined);

	const t4 = "x86_64-unknown-linux-gnu2.37";
	const c4 = components(t4);
	tg.assert(c4.arch === "x86_64");
	tg.assert(c4.os === "linux");
	tg.assert(c4.vendor === "unknown");
	tg.assert(c4.osVersion === undefined);
	tg.assert(c4.environment === "gnu");
	tg.assert(c4.environmentVersion === "2.37");

	const t5 = normalize(create(t0, { arch: "x86_64", environment: "musl" }));
	tg.assert(t5 === "x86_64-unknown-linux-musl");

	return true;
});
