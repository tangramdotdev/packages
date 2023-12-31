export type Triple = {
	arch: Triple.Arch;
	vendor?: Triple.Vendor;
	os: Triple.Os;
	environment?: Triple.Environment;
};

export namespace Triple {
	export type Arch = "aarch64" | "x86_64";

	export let architectures = ["aarch64", "x86_64"];

	export namespace Arch {
		export let is = (value: unknown): value is Arch => {
			return typeof value === "string" && architectures.includes(value);
		};
	}

	export type Vendor = "apple" | "unknown";

	export let vendors = ["apple", "unknown"];

	export namespace Vendor {
		export let is = (value: unknown): value is Vendor => {
			return typeof value === "string" && vendors.includes(value);
		};
	}

	export type Os = "darwin" | "linux";

	export let oss = ["darwin", "linux"];

	export namespace Os {
		export let is = (value: unknown): value is Os => {
			return typeof value === "string" && oss.includes(value);
		};
	}

	export type Environment = "gnu" | "musl";

	export let environments = ["gnu", "musl"];

	export namespace Environment {
		export let is = (value: unknown): value is Environment => {
			return typeof value === "string" && environments.includes(value);
		};
	}

	export type Arg = tg.System | Triple | ArgString;

	export namespace Arg {
		export let is = (value: unknown): value is Arg => {
			return (
				tg.System.is(value) || Triple.is(value) || Triple.ArgString.is(value)
			);
		};
	}

	export type ArgString =
		| `${Arch}-${Os}`
		| `${Arch}-${Vendor}-${Os}`
		| `${Arch}-${Os}-${Environment}`
		| `${Arch}-${Vendor}-${Os}-${Environment}`;

	export namespace ArgString {
		export let is = (value: unknown): value is ArgString => {
			if (!(typeof value === "string")) {
				return false;
			}
			let components = value.split("-");
			if (components.length === 2) {
				return Arch.is(components[0]) && Os.is(components[1]);
			} else if (components.length === 3) {
				let vendor = components[1];
				if (vendor !== undefined) {
					if (vendors.includes(vendor)) {
						return (
							Arch.is(components[0]) &&
							Vendor.is(components[1]) &&
							Os.is(components[2])
						);
					} else {
						return (
							Arch.is(components[0]) &&
							Os.is(components[1]) &&
							Environment.is(components[2])
						);
					}
				} else {
					return false;
				}
			} else if (components.length === 4) {
				return (
					Arch.is(components[0]) &&
					Vendor.is(components[1]) &&
					Os.is(components[2]) &&
					Environment.is(components[3])
				);
			} else {
				return false;
			}
		};
	}

	export let new_ = (arg: unknown): Triple => {
		tg.assert(Triple.Arg.is(arg));
		if (tg.System.is(arg)) {
			return Triple.defaultForSystem(arg);
		} else if (typeof arg === "string") {
			return Triple.fromString(arg);
		} else {
			return arg;
		}
	};

	export let arrayIncludes = (
		arr: Array<Triple.Arg>,
		value: Triple.Arg,
	): boolean => {
		for (let item of arr) {
			if (Triple.eq(item, value)) {
				return true;
			}
		}
		return false;
	};

	export let eq = (a: Triple.Arg, b: Triple.Arg): boolean => {
		return Triple.toString(Triple.new_(a)) === Triple.toString(Triple.new_(b));
	};

	export let is = (value: unknown): value is Triple => {
		return (
			typeof value === "object" &&
			value !== null &&
			"arch" in value &&
			"os" in value
		);
	};

	export let fromString = (string: string): Triple => {
		let components = string.split("-");
		if (components.length === 2) {
			return {
				arch: components[0] as Arch,
				os: components[1] as Os,
			};
		} else if (components.length === 3) {
			let vendor = components[1];
			tg.assert(vendor !== undefined);
			if (vendors.includes(vendor)) {
				return {
					arch: components[0] as Arch,
					vendor: components[1] as Vendor,
					os: components[2] as Os,
				};
			} else {
				return {
					arch: components[0] as Arch,
					os: components[1] as Os,
					environment: components[2] as Environment,
				};
			}
		} else if (components.length === 4) {
			return {
				arch: components[0] as Arch,
				vendor: components[1] as Vendor,
				os: components[2] as Os,
				environment: components[3] as Environment,
			};
		} else {
			throw new Error("Invalid triple string.");
		}
	};

	export let toString = (triple: Triple): string => {
		let string = triple.arch;
		if (triple.vendor) {
			string += `-${triple.vendor}`;
		}
		string += `-${triple.os}`;
		if (triple.environment) {
			string += `-${triple.environment}`;
		}
		return string;
	};

	export let defaultForSystem = (system: tg.System): Triple => {
		switch (system) {
			case "x86_64-linux": {
				return {
					arch: "x86_64",
					vendor: "unknown",
					os: "linux",
					environment: "gnu",
				};
			}
			case "aarch64-linux": {
				return {
					arch: "aarch64",
					vendor: "unknown",
					os: "linux",
					environment: "gnu",
				};
			}
			case "x86_64-darwin": {
				return {
					arch: "x86_64",
					vendor: "apple",
					os: "darwin",
				};
			}
			case "aarch64-darwin": {
				return {
					arch: "aarch64",
					vendor: "apple",
					os: "darwin",
				};
			}
			default: {
				throw new Error(`Unsupported system ${system}`);
			}
		}
	};

	export let system = (triple: Triple.Arg): tg.System => {
		return tg.system(Triple.new_(triple));
	};

	export type HostArg =
		| Triple.Arg
		| {
				host?: Triple.Arg;
		  };

	export let host = async (arg?: HostArg): Promise<Triple> => {
		if (
			arg === undefined ||
			(typeof arg === "object" && (!("host" in arg) || arg.host === undefined))
		) {
			let detectedHost = (await tg.current.env())["TANGRAM_HOST"] as tg.System;
			return Triple.new_(detectedHost);
		} else if (Triple.Arg.is(arg)) {
			return Triple.new_(arg);
		} else if ("host" in arg && Triple.Arg.is(arg.host)) {
			return Triple.new_(arg.host);
		} else {
			return tg.unreachable();
		}
	};

	export let hostSystem = async (arg?: HostArg): Promise<tg.System> => {
		return Triple.system(await Triple.host(arg));
	};

	type BuildAndHostOptions = Triple.HostArg & {
		build?: Triple.Arg;
	};

	type BuildAndHost = {
		build: Triple;
		host: Triple;
	};

	export type HostAndTarget = {
		host: Triple;
		target: Triple;
	};

	export let resolveBuildAndHost = async (
		arg?: BuildAndHostOptions,
	): Promise<BuildAndHost> => {
		let host = await Triple.host(arg);
		let build = arg?.build ? triple(arg.build) : host;
		return { build, host };
	};

	/** Take a package arg with optional build and host triples and produce the corresponding host and target triples for the SDK required to build it. */
	export let rotate = async (
		arg?: BuildAndHostOptions,
	): Promise<HostAndTarget> => {
		let { build, host } = await resolveBuildAndHost(arg);
		return { host: build, target: host };
	};
}

export let triple = Triple.new_;
