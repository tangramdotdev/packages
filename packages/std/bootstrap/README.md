# Tangram Bootstrap

This package provides the preliminary components required to bootstrap the [Tangram](https://www.tangram.dev) ecosystem on [Linux](https://www.kernel.org) and [macOS](https://www.apple.com/macos/).

**TL;DR** Run `make -j"$(nproc)" && tg test` in this directory.

Use the provided `Makefile` to produce these components ahead of running Tangram. Basic usage:

- `make` - Build all host platform components.
- `make list` - Enumerate the host platform components.
- `make clean` - Remove all build artifacts but retain downloaded sources.
- `make clean_all` - Remove all build artifacts AND sources.

After `make` completes, use `tg test` to assert that each expected component in the `dist/` directory is populated.

On macOS, the `list_all_platforms` target enumerates every available component/platform combination. The makefile can optionally build the Linux targets as well using [Docker Desktop](#docker-platform). Use `make all_platforms` to build every available target.

See [**Prerequisites**](#prerequisites) about the required host environment, **[Components](#components)** about the included software, and [**Usage**](#usage) about additional provided targets.

## Definitions

- `artifact` - Anything produced as a result of running a `make` target.
- `component` - A component the `bootstrap` package expects to provide, such as `dash` or `toolchain`.
- `platform` - Either `x86_64_linux`, `aarch64_linux`, or `universal_darwin`.
- `target` - An action supported by this makefile. These can be ["phony"](https://www.gnu.org/software/make/manual/html_node/Phony-Targets.html) (`clean`, `toolchain`) or refer to an actual output file: `$SOURCEDIR/dash-0.5.12.tar.gz`.

## Prerequisites

This makefile is intended to be as portable as possible. However, it must necessarily assume some properties about the computer you're running it on.

Your host system must run of of these operating systems:

- macOS 13+.
- Linux. Confirmed to build on [Ubuntu 18.04 LTS](https://releases.ubuntu.com/18.04/) (Bionic Beaver) and higher.

You also need some standard system utilities for compiling C code, fetching and verifying network content, manipulating text, and traversing your filesystem. To see a complete list, use `make list_needed_commands`. This is the full set on macOS:

```shellsession
$ make list_needed_commands
ar awk bash bzip2 c++ cc cd chmod cp curl find gpg gsed gzip install ld lipo ln make mkdir rm shasum strip tar touch xz zstd
```

### MacOS

```txt
xcode-select --install && brew install gnu-sed zstd
```

Unfortunately, you **must** install [`GNU sed`](https://www.gnu.org/software/sed/) and have it available as `gsed` on your `$PATH` to build the `utils` target.

### Alpine

Tested on version 3.15 and higher.

```txt
apk add alpine-sdk bash curl gpg gpg-agent xz zstd
```

### Fedora

Tested on version 37 and higher.

```txt
dnf install bzip2 gcc make musl-libc xz zstd
```

### Ubuntu

Tested on version 18.04 and higher.

```txt
apt update && apt install build-essential curl musl zstd
```

### Docker Platform

This prerequisite is **optional**. Docker is **not** required to use the host-only targets on either macOS or Linux.

The Docker rules require [Docker Desktop](https://www.docker.com/products/docker-desktop/). The environment setup depends on the multi-platform capabilities provided by [BuildKit](https://docs.docker.com/build/buildkit/) via [`docker buildx`](https://docs.docker.com/engine/reference/commandline/buildx/). Alternate container runtimes like Colima will not work out of the box.

<!-- See https://github.com/abiosoft/colima/issues/44 -->

**NOTE** As of July 5, 2023 with Docker Desktop v4.21.1 (114176), successfully building the `x86_64_linux` targets requires the beta feature "Use Rosetta for x86/amd64 emulation on Apple Silicon" to be toggled OFF. Until this limitation is resolved, `x86_64_linux` builds on Apple Silicon hosts are slow. Go make a cup of tea.

<!-- Dash builds ok.  -->
<!-- busybox:
scripts/kconfig/conf -s Config.in
#
# using defaults found in .config
#
/bootstrap/sources/busybox-1.36.1/modutils/modutils.c: In function 'filename2modname':
/bootstrap/sources/busybox-1.36.1/modutils/modutils.c:115:1: warning: function may return address of local variable [-Wreturn-local-addr]
  115 | }
      | ^
/bootstrap/sources/busybox-1.36.1/modutils/modutils.c:94:14: note: declared here
   94 |         char local_modname[MODULE_NAME_LEN];
      |              ^~~~~~~~~~~~~
assertion failed [result.value != EEXIST]: VmTracker attempted to allocate existing mapping
(ThreadContextVm.cpp:47 mmap)
gcc: internal compiler error: Trace/breakpoint trap signal terminated program cc1
Please submit a full bug report, with preprocessed source (by using -freport-bug).
See <https://gitlab.alpinelinux.org/alpine/aports/-/issues> for instructions.
make[3]: *** [/bootstrap/sources/busybox-1.36.1/scripts/Makefile.build:197: coreutils/stat.o] Error 4
make[2]: *** [/bootstrap/sources/busybox-1.36.1/Makefile:744: coreutils] Error 2
make[2]: *** Waiting for unfinished jobs....
make[1]: *** [Makefile:112: _all] Error 2
make: *** [Makefile:14: all] Error 2
make: *** [build/amd64_linux/utils] Error 2
 -->

## Components

Each component can be used as a `make` target. For example, running `make dash` on an x86_64 Linux computer will produce `$(DESTDIR)/dash_x86_64_linux`.

### Common

Provided for both Linux and MacOS platforms:

- `dash` - A minimal POSIX-compliant shell. Sourced from [gondor.apana.org.au](http://gondor.apana.org.au/~herbert/dash/).
- `toolchain` - On Linux, this is a statically-linked [musl](https://musl.libc.org)-based GCC toolchain sourced from [musl.cc](https://musl.cc). On MacOS, this is the standard Apple Clang distribution.
- `utils` - On Linux, this bundle solely contains [busybox](https://busybox.net/). On macOS, it contains [toybox](http://landley.net/toybox/) alongside [`expr`](https://www.gnu.org/software/coreutils/manual/html_node/expr-invocation.html#expr-invocation), [gawk](https://www.gnu.org/software/gawk/), [grep](https://www.gnu.org/software/grep/), and [`tr`](https://www.gnu.org/software/coreutils/manual/html_node/tr-invocation.html#tr-invocation), all from GNU.

### Linux-only

- `env` - Sourced from [GNU coreutils](https://www.gnu.org/software/coreutils/).

### MacOS-only

- `sdk` - Versioned headers and metadata for macOS APIs. Not to be confused with the [Tangram SDK](https://github.com/tangramdotdev/packages/blob/main/packages/std/sdk.tg)!

On macOS, the distribution platform is always `universal_darwin`. Phony targets created for `x86_64_darwin` and `aarch64_darwin` can be used to manage intermediate build artifacts, but will not appear in `DESTDIR`.

## Usage

The build manages the following directories:

- `DESTDIR` - Output artifacts ready to be included in the Tangram [`bootstrap`](https://github.com/tangramdotdev/packages/blob/main/packages/std/bootstrap.tg) module. Default: `dist`.
- `BUILDDIR` - Intermediate build artifacts. Default: `build`.
- `SOURCEDIR` - Source code, signatures, checksums. Default: `sources`.

The `bootstrap` Tangram package expects the contents produced at `DESTDIR` to be available at `.dist/`, adjacent to `tangram.tg`. Use `tg test` to assert that all required components are present after running the build.

The locations and contents of `BUILDDIR` and `SOURCEDIR` are not meaningful or known to the Tangram package.

### Building

- `all` - equivalent to running `make` with no target defined. Build each supported entrypoint for your host platform.
- `all_platforms` - On MacOS, additionally build the `x86_64_linux` and `aarch64_linux` targets for supported components.
- `<component>` - Build a single component for your detected host platform.
- `<component>_<platform>` - Build a single component for a specific platform, if supported.
- `tarballs` - Create compressed tarballs for each component.
- `validate_environment` - Check for the existence of all required tools in `$PATH`. It is not necessary to call this target manually.

### Cleaning

The top-level `clean` targets are not component-aware and obliterate entire directories:

- `clean` - clear `DESTDIR` and `BUILDDIR`, but retain `SOURCEDIR` contents.
- `clean_all` - clear everything. Equivalent to running the `clean` and `clean_sources` targets.
- `clean_dist` - just clear `DESTDIR`.
- `clean_sources` - just clear `SOURCEDIR`.

Additionally, each component defines cleaning targets which only remove its own artifacts, with the same semantics as above:

- `clean_<component>(_<platform>)?`
- `clean_<component>(_<platform>)?_all`
- `clean_<component>(_<platform>)?_dist`
- `clean_<component>(_<platform>)?_sources`

Omitting the platform is equivalent to specifying your host platform. For example, `clean_dash_dist` and `clean_dash_universal_darwin_dist` are equivalent on a macOS computer.

Note that multiple platforms may depend on the same sources. Using a platform-specific target to clean sources will affect all platforms that share that source. For example, running `make clean_dash_x86_64_linux_sources` will force `make dash_universal_darwin` to re-download the source code as well.

### Listing

None of these targets will catalyze any builds or downloads.

- `list` - Enumerate all targets that will be produced by `make all`.
- `list_all_targets` - Enumerate every single available target.
- `list_needed_commands` - Enumerate every utility that must be present in your `$PATH` to build successfully.
- `list_cross_targets` - On macOS, enumerate all available cross-platform distribution targets.
- `list_all_platforms` - On macOS, enumerate all targets that will be produced by `make all_platforms`. This set is the union of the targets given by `list` and `list_cross_targets`.

### Docker

On MacOS, the following targets can be used to manage the Docker containers and images required for building the Linux components:

- `docker_images` - build the Docker images for Linux builds.
- `docker_stopall` - stop any container this Makefile can create.
- `clean_docker` - Stop and remove all docker containers and images created by this Makefile.

You do not need to manually call `docker_images` before building these components, it's just provided for completeness.
