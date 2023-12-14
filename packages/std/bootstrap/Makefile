## Definitions

# Platform detection
OS := $(shell uname -s)
ARCH := $(shell uname -m)
ifeq ($(ARCH),arm64)
ARCH := aarch64
else ifeq ($(ARCH),amd64)
ARCH := x86_64
endif

# Provided components
COMMON_COMPONENTS :=  dash toolchain utils
LINUX_COMPONENTS := env
ifeq ($(OS),Darwin)
MACOS_COMPONENTS := sdk
endif

# Source package metadata
BUSYBOX_BASE_URL = https://busybox.net/downloads
BUSYBOX_VERSION = 1.36.1

DASH_BASE_URL = http://gondor.apana.org.au/~herbert/dash/files
DASH_VERSION = 0.5.12

GNU_BASE_URL = https://ftp.gnu.org/gnu
COREUTILS_VERSION = 9.4

MUSL_CC_BASE_URL = https://musl.cc

ifeq ($(OS),Darwin)
GAWK_VERSION = 5.2.2
GREP_VERSION = 3.11

# NOTE - Unlike the others, this remote host doesn't provide an adjacent signature or checksum file to download.
TOYBOX_SHA256SUM = d3afee05ca90bf425ced73f527e418fecd626c5340b5f58711a14531f8d7d108
TOYBOX_BASE_URL = http://landley.net/toybox/downloads
TOYBOX_VERSION = 0.8.10
endif

# Managed directories
ifeq ($(strip $(DESTDIR)),)
DESTDIR := dist
endif
ifeq ($(strip $(SOURCEDIR)),)
SOURCEDIR := sources
endif
ifeq ($(strip $(BUILDDIR)),)
BUILDDIR := build
endif

# Define the components and platforms this Makefile supports. On Linux, only build the host platform.  On MacOS, build all platforms.
ALL_ARCHES = aarch64 x86_64
LINUX_PLATFORMS := $(foreach ARCH,$(ALL_ARCHES),$(ARCH)_linux)
ifeq ($(OS),Darwin)
ALL_CROSS_COMPONENTS := $(sort $(COMMON_COMPONENTS) $(LINUX_COMPONENTS))
ALL_HOST_COMPONENTS := $(sort $(COMMON_COMPONENTS) $(MACOS_COMPONENTS))
ALL_COMPONENTS := $(sort $(COMMON_COMPONENTS) $(LINUX_COMPONENTS) $(MACOS_COMPONENTS))
MACOS_PLATFORMS := $(foreach ARCH,$(ALL_ARCHES),$(ARCH)_darwin)
SINGLE_TARGET_PLATFORMS := $(LINUX_PLATFORMS) $(MACOS_PLATFORMS)
HOST_PLATFORM := universal_darwin
ALL_PLATFORMS := $(SINGLE_TARGET_PLATFORMS) $(HOST_PLATFORM)
PHONY_TARGET_PLATFORMS := $(LINUX_PLATFORMS) $(HOST_PLATFORM)
else ifeq ($(OS),Linux)
ALL_HOST_COMPONENTS := $(sort $(COMMON_COMPONENTS) $(LINUX_COMPONENTS))
ALL_COMPONENTS := $(sort $(ALL_HOST_COMPONENTS))
HOST_PLATFORM := $(ARCH)_linux
ALL_PLATFORMS := $(HOST_PLATFORM)
PHONY_TARGET_PLATFORMS := $(HOST_PLATFORM)
SINGLE_TARGET_PLATFORMS := $(HOST_PLATFORM)
endif

## Top-level targets

# The default target will build all components for the host platform.
.PHONY: all
all: $(ALL_HOST_COMPONENTS)

ALL_PACKAGES := $(shell find $(DESTDIR) -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -vE "\.tar\.*$$")
TARBALLS := $(addsuffix .tar.zstd,$(ALL_PACKAGES))
SHASUMS := $(addsuffix .sha256sum,$(TARBALLS))
.PHONY: tarballs
tarballs: all $(TARBALLS) $(SHASUMS)

# On MacOS, additionally build all components for all other platforms.
ifeq ($(OS),Darwin)
NON_MACOS_TARGET_PLATFORMS := $(filter-out $(MACOS_PLATFORMS) $(HOST_PLATFORM),$(ALL_PLATFORMS))
ALL_PLATFORM_TARGETS := $(sort $(foreach TARGET,$(ALL_CROSS_COMPONENTS),$(foreach PLATFORM,$(NON_MACOS_TARGET_PLATFORMS),$(TARGET)_$(PLATFORM))))

.PHONY: all_platforms
all_platforms: all $(ALL_PLATFORM_TARGETS)
endif

# Top-level clean targets, which blow away whole directories.  Use the component-specific clean targets for more fine-grained control.
.PHONY: clean
clean: clean_dist
	@rm -rfv $(BUILDDIR)

.PHONY: clean_all
clean_all: clean clean_sources

.PHONY: clean_dist
clean_dist:
	@find $(DESTDIR) -mindepth 1 -not -name '.gitignore' -delete

.PHONY: clean_sources
clean_sources:
	@rm -rfv $(SOURCEDIR)

## Create phony targets for all enabled components.

# Each component gets an entrypoint phony target for the host platform.
define component_entrypoint
.PHONY: $(1)
$(1): $(1)_$(HOST_PLATFORM)
endef

$(foreach COMPONENT,$(ALL_HOST_COMPONENTS),$(eval $(call component_entrypoint,$(COMPONENT))))

# Additionally, each component gets a set phony target for each enabled platform.
define component_platform_entrypoints
.PHONY: $(1)_$(2)
$(1)_$(2): $(DESTDIR)/$(1)_$(2)

.PHONY: clean_$(1)
clean_$(1): clean_$(1)_$(2)

.PHONY: clean_$(1)_dist
clean_$(1)_dist: clean_$(1)_$(2)_dist

.PHONY: clean_$(1)_all
clean_$(1)_all: clean_$(1)_$(2)_all

.PHONY: clean_$(1)_sources
clean_$(1)_sources: clean_$(1)_$(2)_sources
endef

$(foreach COMPONENT,$(ALL_COMPONENTS),\
	$(foreach PLATFORM,$(PHONY_TARGET_PLATFORMS),\
		$(eval $(call component_platform_entrypoints,$(COMPONENT),$(PLATFORM)))))

# The universal_darwin targets should also clean up the individual darwin targets.
ifeq ($(OS),Darwin)
define universal_darwin_targets
.PRECIOUS: $(BUILDDIR)/universal_darwin/$(1)

.PHONY: clean_$(1)_universal_darwin
clean_$(1)_universal_darwin: clean_$(1)_universal_darwin_dist clean_$(1)_aarch64_darwin clean_$(1)_x86_64_darwin
	@rm -rfv $(BUILDDIR)/universal_darwin/$(1)*

.PHONY: clean_$(1)_universal_darwin_dist
clean_$(1)_universal_darwin_dist:
	@rm -rfv $(DESTDIR)/$(1)_universal_darwin

.PHONY: clean_$(1)_universal_darwin_all
clean_$(1)_universal_darwin_all: clean_$(1)_universal_darwin clean_$(1)_universal_darwin_sources

.PHONY: clean_$(1)_universal_darwin_sources
clean_$(1)_universal_darwin_sources: clean_$(1)_aarch64_darwin_sources
endef
$(foreach COMPONENT,$(ALL_HOST_COMPONENTS),$(eval $(call universal_darwin_targets,$(COMPONENT))))
endif

## Validate build environment.

define ensure_command
if ! command -v $(1) >/dev/null 2>&1; then \
	echo $(2); \
	exit 1; \
fi
endef

TOOLCHAIN := $(BUILDDIR)/$(HOST_PLATFORM)/toolchain.stamp

ifeq ($(OS),Linux)
# On Linux, use the musl.cc toolchain.
OS_COMMANDS := sha256sum sha512sum sed
LINUX_TOOLCHAIN := $(DESTDIR)/toolchain_$(ARCH)_linux
$(TOOLCHAIN): $(LINUX_TOOLCHAIN)
	@mkdir -p $(@D)
	@touch $@
else ifeq ($(OS),Darwin)
# On MacOS, use the system toolchain.
OS_COMMANDS := cc c++ gsed ld lipo shasum
LINUX_TOOLCHAIN := $(DESTDIR)/toolchain_x86_64_linux $(DESTDIR)/toolchain_aarch64_linux
$(TOOLCHAIN):
	@$(call ensure_command,cc,"Error: Xcode Command Line Tools are not installed! Run `xcode-select --install`.")
	@mkdir -p $(@D)
	@touch $@
endif

COMMANDS := $(OS_COMMANDS) ar awk bash bzip2 cd chmod cp curl find gpg gzip install ln make mkdir rm strip tar touch xz zstd
ENVIRONMENT := $(BUILDDIR)/$(HOST_PLATFORM)/environment.stamp
$(ENVIRONMENT): $(TOOLCHAIN)
	@for cmd in $(COMMANDS); do \
		$(call ensure_command,$$cmd,"Error: $$cmd not found in \$$PATH!"); \
	done
	@mkdir -p $(@D)
	@touch $@

.PHONY: list_needed_commands
list_needed_commands:
	@echo $(sort $(COMMANDS))

.PHONY: validate_environment
validate_environment: $(ENVIRONMENT)

## Dash

# Create a distribution artifact including an `sh` symlink.
define dash_dist_target
$(DESTDIR)/dash_$(1): $(BUILDDIR)/$(1)/dash
	@mkdir -p $$@/bin
	@cp $$< $$@/bin
	@cd $$@/bin && ln -sf ./dash ./sh
	@touch $$@
endef
$(foreach PLATFORM,$(PHONY_TARGET_PLATFORMS),$(eval $(call dash_dist_target,$(PLATFORM))))

# These targets are defined for the single-target platforms: x86_64_linux, aarch64_linux, x86_64_darwin, aarch64_darwin.
define dash_targets
$(BUILDDIR)/$(1)/dash: $(SOURCEDIR)/dash-$(DASH_VERSION) $(BUILDDIR)/docker_images.stamp $(ENVIRONMENT)
	@$$(call build_$$(call get_os,$(1)),$$<,$$(call get_arch,$(1)),src/dash,$$@)

.PHONY: clean_dash_$(1)
clean_dash_$(1): clean_dash_$(1)_dist
	@rm -rfv $(BUILDDIR)/$(1)/dash*

.PHONY: clean_dash_$(1)_dist
clean_dash_$(1)_dist:
	@rm -rfv $(DESTDIR)/dash_$(1)

.PHONY: clean_dash_$(1)_all
clean_dash_$(1)_all: clean_dash_$(1) clean_dash_$(1)_sources

.PHONY: clean_dash_$(1)_sources
clean_dash_$(1)_sources: clean_dash_source
endef

$(foreach PLATFORM,$(SINGLE_TARGET_PLATFORMS),$(eval $(call dash_targets,$(PLATFORM))))

.PHONY: clean_dash_source
clean_dash_source:
	@rm -rfv $(SOURCEDIR)/dash*

$(SOURCEDIR)/dash-$(DASH_VERSION).tar.gz.stamp: $(SOURCEDIR)/dash-$(DASH_VERSION).tar.gz $(SOURCEDIR)/dash-$(DASH_VERSION).tar.gz.sha512sum
	@ACTUAL=$(call sha,512,$<) && \
	EXPECTED=$$(awk '/Hash: SHA512/{getline; getline; print $$1}' $(word 2,$^)) && \
	$(call verify_checksum,$$ACTUAL,$$EXPECTED,$<,$@)

$(SOURCEDIR)/dash-$(DASH_VERSION).tar.gz $(SOURCEDIR)/dash-$(DASH_VERSION).tar.gz.sha512sum:
	@$(call download,$(DASH_BASE_URL)/$(@F),$@)

## env

.PHONY: clean_env_source
clean_env_source: clean_coreutils_source

define env_targets
.PHONY: env_$(1)
env_$(1): $(DESTDIR)/env_$(1)

.PHONY: clean_env_$(1)
clean_env_$(1): clean_env_$(1)_dist
	@rm -rfv $(BUILDDIR)/$(1)/env

.PHONY: clean_env_$(1)_dist
clean_env_$(1)_dist:
	@rm -rfv $(DESTDIR)/env_$(1)

.PHONY: clean_env_$(1)_all
clean_env_$(1)_all: clean_env_$(1) clean_env_source

$(DESTDIR)/env_$(1): $(BUILDDIR)/$(1)/env
	@mkdir -p $$@/bin
	@cp $$< $$@/bin
endef

$(foreach PLATFORM,$(PHONY_TARGET_PLATFORMS),$(eval $(call env_targets,$(PLATFORM))))

define build_env_target
$(BUILDDIR)/$(1)/env: $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION) $(TOOLCHAIN) $(ENVIRONMENT)
	@$$(call build_linux,$$<,$$(call get_arch,$(1)),src/env,$$@)
endef

$(foreach arch,$(ALL_ARCHES),$(eval $(call build_env_target,$(arch)_linux)))

## Linux toolchain (musl.cc)

ifeq ($(OS),Darwin)
define toolchain_cross_linux_targets
.PHONY: toolchain_$(1)
toolchain_$(1): $(DESTDIR)/toolchain_$(1)
endef
$(foreach PLATFORM,$(LINUX_PLATFORMS),$(eval $(call toolchain_cross_linux_targets,$(PLATFORM))))
endif

.PHONY: clean_musl_cc_source
clean_musl_cc_source:
	@rm -rfv $(SOURCEDIR)/*-linux-musl-native.tgz*

define toolchain_linux_targets
.PHONY: clean_toolchain_$(1)
clean_toolchain_$(1): clean_toolchain_$(1)_dist

.PHONY: clean_toolchain_$(1)_dist
clean_toolchain_$(1)_dist:
	@rm -rfv $(DESTDIR)/toolchain_$(1)

.PHONY: clean_toolchain_$(1)_all
clean_toolchain_$(1)_all: clean_toolchain_$(1) clean_musl_cc_source
endef

$(foreach PLATFORM,$(LINUX_PLATFORMS),$(eval $(call toolchain_linux_targets,$(PLATFORM))))

define fixup_musl_cc_directory
$(eval TARBALL := $(subst .stamp,,$<))
mkdir -p $(2)
tar -xf $(TARBALL) --strip-components=1 -C $(2)
$(call set_arch,$(1)) && \
INTERP=ld-musl-$$ARCH.so.1 && \
cd $(2)/lib && \
rm $$INTERP && \
ln -s libc.so $$INTERP
cd $(2)/bin && \
ln -s gcc cc
touch $(2)
endef

$(DESTDIR)/toolchain_x86_64_linux: $(SOURCEDIR)/x86_64-linux-musl-native.tgz.stamp
	@$(call fixup_musl_cc_directory,x86_64,$@)

$(DESTDIR)/toolchain_aarch64_linux: $(SOURCEDIR)/aarch64-linux-musl-native.tgz.stamp
	@$(call fixup_musl_cc_directory,aarch64,$@)

$(SOURCEDIR)/%-linux-musl-native.tgz.stamp: $(SOURCEDIR)/%-linux-musl-native.tgz $(SOURCEDIR)/musl_cc_sha512sums.txt
	@ACTUAL=$(call sha,512,$<) && \
	EXPECTED=$$(awk '/$(notdir $<)/{print $$1}' $(word 2,$^)) && \
	$(call verify_checksum,$$ACTUAL,$$EXPECTED,$<,$@)

$(foreach ARCH,aarch64 x86_64,$(eval .PRECIOUS: $(SOURCEDIR)/$(ARCH)-linux-musl-native.tgz))

$(SOURCEDIR)/%-linux-musl-native.tgz:
	@$(call download,$(MUSL_CC_BASE_URL)/$(@F),$@)

$(SOURCEDIR)/musl_cc_sha512sums.txt:
	@$(call download,$(MUSL_CC_BASE_URL)/SHA512SUMS,$@)

## Linux utils (busybox)

.PHONY: clean_busybox_source
clean_busybox_source:
	@rm -rfv $(SOURCEDIR)/busybox*

ifeq ($(OS),Darwin)
ROOT := /bootstrap
else ifeq ($(OS),Linux)
ROOT := $(CURDIR)
endif
define build_busybox_script
$(call build_in_temp,$(1),$(2),make KBUILD_SRC="$$SOURCE" -f "$$SOURCE"/Makefile defconfig && \
sed -i "s/^# CONFIG_STATIC is not set$$/CONFIG_STATIC=y/" .config && \
export TOOLCHAIN_ARCH="$$(uname -m)" && \
export LINUX_TOOLCHAIN=$(ROOT)/$(DESTDIR)/toolchain_"$$TOOLCHAIN_ARCH"_linux && \
export PATH="$$LINUX_TOOLCHAIN/bin:$$PATH" && \
export CC="$$LINUX_TOOLCHAIN/bin/gcc --sysroot=$$LINUX_TOOLCHAIN -static" && \
make -j$$(nproc) && \
strip --strip-unneeded busybox && \
mkdir -p $$TARGET/bin && \
rm -rf $$TARGET/bin/* && \
cp busybox "$$TARGET"/bin && \
cd "$$TARGET"/bin && \
for cmd in $$(./busybox --list); do \
	if [ "$$cmd" = "busybox" ]; then \
		continue; \
	fi && \
	ln -s ./busybox "$$cmd"; \
done)
endef

$(DESTDIR)/utils_%: $(BUILDDIR)/%/utils
	@mkdir -p $(@D)
	@cp -R $< $@
	@touch $@

ifeq ($(OS),Darwin)
define build_linux_utils_targets
.PHONY: clean_utils_$(1)
clean_utils_$(1): clean_utils_$(1)_dist
	@rm -rfv $(BUILDDIR)/$(1)/utils

.PHONY: clean_utils_$(1)_dist
clean_utils_$(1)_dist:
	@rm -rfv $(DESTDIR)/utils_$(1)

.PHONY: clean_utils_$(1)_all
clean_utils_$(1)_all: clean_utils_$(1) clean_utils_$(1)_sources

.PHONY: clean_utils_$(1)_sources
clean_utils_$(1)_sources: clean_busybox_source

$(BUILDDIR)/$(1)/utils: $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION) $(ENVIRONMENT)
	@$$(call run_linux_docker_build,$$(call build_busybox_script,$$<,$$@),$$(call get_arch,$(1)))
	@touch $$@
endef
$(foreach platform,$(LINUX_PLATFORMS),$(eval $(call build_linux_utils_targets,$(platform))))
else
.PHONY: clean_utils_$(HOST_PLATFORM)
clean_utils_$(HOST_PLATFORM): clean_utils_$(HOST_PLATFORM)_dist
	@rm -rfv $(BUILDDIR)/$(HOST_PLATFORM)/utils

.PHONY: clean_utils_$(HOST_PLATFORM)_dist
clean_utils_$(HOST_PLATFORM)_dist:
	@rm -rfv $(DESTDIR)/utils_$(HOST_PLATFORM)

.PHONY: clean_utils_$(HOST_PLATFORM)_all
clean_utils_$(HOST_PLATFORM)_all: clean_utils_$(HOST_PLATFORM) clean_utils_$(HOST_PLATFORM)_sources

.PHONY: clean_utils_$(HOST_PLATFORM)_sources
clean_utils_$(HOST_PLATFORM)_sources: clean_busybox_source

$(BUILDDIR)/$(HOST_PLATFORM)/utils: $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION) $(ENVIRONMENT)
	@$(call build_busybox_script,$<,$@),$(call get_arch,$(1))
	@touch $@
endif

$(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2.stamp: $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2 $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2.sha256 $(ENVIRONMENT)
	@ACTUAL=$(call sha,256,$<) && \
	EXPECTED=$$(awk '/$(notdir $<)/{print $$1}' $(word 2,$^)) && \
	$(call verify_checksum,$$ACTUAL,$$EXPECTED,$<,$@)

$(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2 $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2.sig $(SOURCEDIR)/busybox-$(BUSYBOX_VERSION).tar.bz2.sha256:
	@$(call download,$(BUSYBOX_BASE_URL)/$(@F),$@)

## macOS toolchain, sdk

# FIXME - it's generating meaningless sdk_arm64_linux targets, which prevent clean_sdk_* from working properly.
# For display, it should just give `sdk`, not `sdk_unversal_darwin`.  This one is still custom, re-introduce the custom-targets thing.

ifeq ($(OS),Darwin)
MACOS_COMMAND_LINE_TOOLS_PATH := /Library/Developer/CommandLineTools
MACOS_SDK_VERSIONS := 12.1 12.3 13.3 14.2

.PHONY: $(DESTDIR)/sdk_universal_darwin
$(DESTDIR)/sdk_universal_darwin: $(foreach VERSION,$(MACOS_SDK_VERSIONS),$(DESTDIR)/sdk_$(VERSION)_universal_darwin)

define build_darwin_sdk_target
.PRECIOUS: $$(BUILDDIR)/universal_darwin/sdk_$(1)

.PHONY: sdk_$(1)
sdk_$(1): $$(DESTDIR)/sdk_$(1)_universal_darwin

.PHONY: clean_sdk_$(1)
clean_sdk_$(1): clean_sdk_$(1)_dist
	@rm -rfv $$(BUILDDIR)/universal_darwin/sdk_$(1)

.PHONY: clean_sdk_$(1)_dist
clean_sdk_$(1)_dist:
	@rm -rfv $$(DESTDIR)/sdk_$(1)_universal_darwin

$(DESTDIR)/sdk_$(1)_universal_darwin: $(BUILDDIR)/universal_darwin/sdk_$(1) $(ENVIRONMENT)
	@mkdir -p $$(@D)
	@cp -R $$< $$@

$(BUILDDIR)/universal_darwin/sdk_$(1):
	@mkdir -p $$@
	@cp -R $(MACOS_COMMAND_LINE_TOOLS_PATH)/SDKs/MacOSX$$*.sdk/* $$@
endef

$(foreach VERSION,$(MACOS_SDK_VERSIONS),$(eval $(call build_darwin_sdk_target,$(VERSION))))

$(DESTDIR)/toolchain_universal_darwin: $(BUILDDIR)/universal_darwin/toolchain $(ENVIRONMENT)
	@mkdir -p $(@D)
	@cp -R $< $@

$(BUILDDIR)/universal_darwin/toolchain:
	@mkdir -p $@
	@cp -R $(MACOS_COMMAND_LINE_TOOLS_PATH)/usr/* $@
endif

## macOS utils

ifeq ($(OS),Darwin)
MACOS_BOOTSTRAP_UTILS = awk expr grep tr toybox
MACOS_BOOTSTRAP_UTILS_BUILD_PATH := $(BUILDDIR)/universal_darwin/utils
MACOS_BOOTSTRAP_UTILS_TARGETS := $(subst awk,gawk,$(MACOS_BOOTSTRAP_UTILS))

$(DESTDIR)/utils_universal_darwin: $(foreach UTIL,$(filter-out toybox,$(MACOS_BOOTSTRAP_UTILS)),$(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/$(UTIL)) $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/toybox.stamp
	@mkdir -p $(@D)
	@cp -R $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH) $@
	@find $(@D) -type f -name '*.stamp' -delete 2>/dev/null || true

$(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/%: $(BUILDDIR)/universal_darwin/%
	@mkdir -p $(@D)
	@cp $< $@

# NOTE - these are unused, only provided for completeness.
.PHONY: clean_utils_aarch64_darwin clean_utils_x86_64_darwin
clean_utils_aarch64_darwin clean_utils_x86_64_darwin:

.PHONY: clean_utils_aarch64_darwin_sources clean_utils_x86_64_darwin_sources
clean_utils_aarch64_darwin_sources clean_utils_x86_64_darwin_sources:
endif

# GNU coreutils and other GNU common rules
# NOTE - the `env`, `expr`, and `tr` targets all share this source.  There is no target to obtain a complete coreutils installation, just the individual tools required.

.PHONY: clean_coreutils_source
clean_coreutils_source: clean_gnu_keyring
	@rm -rfv $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION)* $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz.sig $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz

.PHONY: clean_gnu_keyring
clean_gnu_keyring:
	@rm -rfv $(SOURCEDIR)/gnu-keyring.gpg*

$(SOURCEDIR)/gnu-keyring.gpg.stamp: $(SOURCEDIR)/gnu-keyring.gpg
	@gpg --import $<
	@touch $@

$(SOURCEDIR)/gnu-keyring.gpg:
	$(call download,$(GNU_BASE_URL)/$(@F),$@)

ifeq ($(OS),Linux)
$(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz.stamp: $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz.sig $(SOURCEDIR)/gnu-keyring.gpg.stamp $(ENVIRONMENT)
	@gpg --verify $(word 2,$^)
	@touch $@

$(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz $(SOURCEDIR)/coreutils-$(COREUTILS_VERSION).tar.xz.sig:
	$(call download,$(GNU_BASE_URL)/coreutils/$(@F),$@)
endif

ifeq ($(OS),Darwin)
define both_darwin_architectures_from_gnu_targets
$$(foreach ARCH,$(ALL_ARCHES),$(BUILDDIR)/$$(ARCH)_darwin/$(1)): $(SOURCEDIR)/$(1)-$(2) $(ENVIRONMENT)
	@$$(call build_darwin_and_install,$$<,$$(call get_arch,$$(notdir $$(@D))),$$@)

$(SOURCEDIR)/$(1)-$(2).tar.xz.stamp: $(SOURCEDIR)/$(1)-$(2).tar.xz $(SOURCEDIR)/$(1)-$(2).tar.xz.sig $(SOURCEDIR)/gnu-keyring.gpg.stamp $(ENVIRONMENT)
	@gpg --verify $$(word 2,$$^)
	@touch $$@

$(SOURCEDIR)/$(1)-$(2).tar.xz $(SOURCEDIR)/$(1)-$(2).tar.xz.sig:
	@$$(call download,$$(GNU_BASE_URL)/$(1)/$$(notdir $$@),$$@)
endef

$(eval $(call both_darwin_architectures_from_gnu_targets,coreutils,$(COREUTILS_VERSION)))

## MacOS utils

# expr and tr from GNU coreutils
define darwin_single_coreutils_targets
.PHONY: $(1)_darwin
$(1)_darwin: $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/$(1)

.PHONY: clean_$(1)_darwin
clean_$(1)_darwin:
	@rm -rfv $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/$(1)

.PHONY: clean_$(1)_darwin_all
clean_$(1)_darwin_all: clean_$(1)_darwin clean_coreutils_source

$(foreach ARCH,$(ALL_ARCHES),$(eval $(BUILDDIR)/$(ARCH)_darwin/$(1): $(BUILDDIR)/$(ARCH)_darwin/coreutils ; \
	@cp $$</bin/$$(@F) $$@))
endef

$(foreach TOOL,expr tr,$(eval $(call darwin_single_coreutils_targets,$(TOOL))))

# gawk and grep from individual GNU packages
$(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/awk: $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/gawk
	@mkdir -p $(@D)
	@cd $(@D) && ln -sf ./gawk ./awk

define darwin_single_gnu_targets
.PHONY: $(1)_darwin
$(1)_darwin: $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/$(1)

.PHONY: clean_$(1)_darwin
clean_$(1)_darwin:
	@rm -rfv $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/$(1) $$(foreach PLATFORM,$$(MACOS_PLATFORMS) $$(HOST_PLATFORM),$(BUILDDIR)/$$(PLATFORM)/$(1)*)

.PHONY: clean_$(1)_darwin_all
clean_$(1)_darwin_all: clean_$(1)_darwin clean_$(1)_source

.PHONY: clean_$(1)_source
clean_$(1)_source:
	@rm -rfv $(SOURCEDIR)/$(1)-$(2)*

$$(eval $$(call both_darwin_architectures_from_gnu_targets,$(1),$(2)))

$(foreach PLATFORM,$(MACOS_PLATFORMS),$(eval $(BUILDDIR)/$(PLATFORM)/$(1)/bin/$(1): $(BUILDDIR)/$(PLATFORM)/$(1) $(ENVIRONMENT)))
endef

$(eval $(call darwin_single_gnu_targets,gawk,$(GAWK_VERSION)))

$(eval $(call darwin_single_gnu_targets,grep,$(GREP_VERSION)))

## Toybox (macOS utils)

TOYBOX_TARGETS := $(foreach ARCH,$(ALL_ARCHES),$(BUILDDIR)/$(ARCH)_darwin/toybox)

.PHONY: toybox_darwin
toybox_darwin: $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/toybox.stamp

.PHONY: clean_toybox_darwin
clean_toybox_darwin:
	@cd $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin && \
	for cmd in $$(./toybox || echo ""); do \
		rm -f "$$cmd"; \
	done
	@rm -rfv $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/toybox* $(TOYBOX_TARGETS)

.PHONY: clean_toybox_darwin_all
clean_toybox_darwin_all: clean_toybox_darwin clean_toybox_source

.PHONY: clean_toybox_source
clean_toybox_source:
	@rm -rfv $(SOURCEDIR)/toybox-$(TOYBOX_VERSION)*

# The separate stamp target creates symlinks for the needed toybox utilities.
$(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/toybox.stamp: $(MACOS_BOOTSTRAP_UTILS_BUILD_PATH)/bin/toybox
	@cd $(@D) && \
	for cmd in $$(./toybox); do \
		skip="toybox grep egrep fgrep"; \
		for skipCmd in $$skip; do \
			if [ "$$cmd" = "$$skipCmd" ]; then \
				continue 2; \
			fi; \
		done && \
		ln -sf ./toybox "$$cmd"; \
	done
	@touch $@

define build_toybox_darwin
	$(call set_arch_darwin,$(2)) && \
	mkdir -p $(@D) && \
	TMP=$$(mktemp -d) && \
	DEST=$(CURDIR)/$(3) && \
	cp -R $</* $$TMP && \
	cd $$TMP && \
	$(MAKE) macos_defconfig && \
	$(MAKE) -j$$(nproc) CFLAGS="-Os -target $$ARCH-apple-darwin" && \
	chmod +w toybox && \
	strip -S toybox && \
	cp toybox $$DEST && \
	cd $(CURDIR) && \
	rm -rf $$TMP
endef

$(foreach ARCH,$(ALL_ARCHES),$(eval $(BUILDDIR)/$(ARCH)_darwin/toybox: $(SOURCEDIR)/toybox-$(TOYBOX_VERSION) $(ENVIRONMENT) ; \
	@$$(call build_toybox_darwin,$$<,$(ARCH),$$@)))

$(SOURCEDIR)/toybox-$(TOYBOX_VERSION).tar.gz.stamp: $(SOURCEDIR)/toybox-$(TOYBOX_VERSION).tar.gz $(ENVIRONMENT)
	@$(call verify_checksum,$(call sha,256,$<),$(TOYBOX_SHA256SUM),$<,$@)

$(SOURCEDIR)/toybox-$(TOYBOX_VERSION).tar.gz:
	@$(call download,$(TOYBOX_BASE_URL)/$(@F),$@)
endif

## Common rules and definitions

# Unpack a source tarball into the build directory.
define unpack_tarball
$(SOURCEDIR)/%: $(SOURCEDIR)/%$(1).stamp
	@mkdir -p $$(@D)
	@tar -xf $$(basename $$<) -C $$(@D)
	@touch $$@
endef

SUPPORTED_EXTENSIONS = .tar.bz2 .tar.gz .tgz .tar.xz
$(foreach EXT,$(SUPPORTED_EXTENSIONS),$(eval $(call unpack_tarball,$(EXT))))

# Create tarballs from output directories
$(DESTDIR)/%.tar.zstd: $(DESTDIR)/%
	@tar -cf - -C $< . | zstd -z -10 -T0 -o $@ -
	@touch $@

$(DESTDIR)/%.tar.zstd.sha256sum: $(DESTDIR)/%.tar.zstd
	@$(sha256) $< > $@

# Create a fat mach-o binary from two single-arch mach-o binaries.
ifeq ($(OS),Darwin)
define universal_darwin_target
.PRECIOUS: $(BUILDDIR)/universal_darwin/$(1)
$(BUILDDIR)/universal_darwin/$(1): $(BUILDDIR)/aarch64_darwin/$(2) $(BUILDDIR)/x86_64_darwin/$(2)
	@mkdir -p $$(@D)
	@lipo -create $$^ -output $$@
endef
$(foreach TOOL,dash expr toybox tr,$(eval $(call universal_darwin_target,$(TOOL),$(TOOL))))
$(foreach TOOL,gawk grep,$(eval $(call universal_darwin_target,$(TOOL),$(TOOL)/bin/$(TOOL))))
endif

# Set ARCH with the corresponding string for the target arch.
define set_arch_darwin
if [ $(1) = "aarch64" ]; then \
	ARCH="arm64"; \
elif [ $(1) = "x86_64" ]; then \
	ARCH="x86_64"; \
else \
	echo "Unknown arch $(1)"; \
	exit 1; \
fi
endef
define set_arch
if [ $(1) = "aarch64" ]; then \
	ARCH="aarch64"; \
elif [ $(1) = "x86_64" ]; then \
	ARCH="x86_64"; \
else \
	echo "Unknown arch $(1)"; \
	exit 1; \
fi
endef

# Compile a darwin binary for a single target.
ifeq ($(OS),Darwin)
define build_darwin
$(info $(4))
$(call set_arch_darwin,$(2)) && \
TMP=$$(mktemp -d) && \
SOURCE=$(CURDIR)/$(1) && \
EXE=$$TMP/$(3) && \
DEST=$(CURDIR)/$(4) && \
TARGET="$$ARCH-apple-darwin" && \
cd $$TMP && \
$$SOURCE/configure --host=$$TARGET CFLAGS="-Os -target $$TARGET" && \
$(MAKE) -j$$(nproc) && \
mkdir -pv $$(dirname $$DEST) && \
cp -v $$EXE $$DEST && \
cd $(CURDIR) && \
rm -rf $$TMP
endef
endif

# Compile and install a darwin binary for a single target.
ifeq ($(OS),Darwin)
define build_darwin_and_install
$(info $(3))
$(call set_arch_darwin,$(2)) && \
TMP=$$(mktemp -d) && \
SOURCE=$(CURDIR)/$(1) && \
DEST=$(CURDIR)/$(3) && \
TARGET="$$ARCH-apple-darwin" && \
cd $$TMP && \
$$SOURCE/configure --prefix="$$DEST" --host=$$TARGET CFLAGS="-Os -target $$TARGET" --disable-perl-regexp && \
$(MAKE) -j$$(nproc) && \
$(MAKE) install && \
cd $(CURDIR) && \
rm -rf $$TMP
endef
endif

# Compile a Linux program with a single output binary.
# NOTE - FORCE_UNSAFE_CONFIGURE is only necessary for coreutils, and `--enable-static` is only necessary for dash.  Netiher breaks the other, so for simplicity we just always pass both.
define single_target_linux_script
$(call build_in_temp,$(1),$(2),export FORCE_UNSAFE_CONFIGURE=1 && \
export TOOLCHAIN_ARCH="$$(uname -m)" && \
export LINUX_TOOLCHAIN=$(ROOT)/$(DESTDIR)/toolchain_"$$TOOLCHAIN_ARCH"_linux && \
export PATH="$$LINUX_TOOLCHAIN/bin:$$PATH" && \
export CC="$$LINUX_TOOLCHAIN/bin/gcc --sysroot=$$LINUX_TOOLCHAIN -static" && \
export CFLAGS="-Os -fPIE -fPIC" && \
export LDFLAGS="-s" && \
$$SOURCE/configure --enable-static && \
make -j$$(nproc) && \
mkdir -p $$(dirname $$TARGET) && \
cp $(3) $(basename $$TARGET))
endef

ifeq ($(OS),Darwin)
# Build a linux binary in a temp directory inside a docker container.
define build_in_temp
SOURCE=/bootstrap/$(1) && \
TARGET=/bootstrap/$(2) && \
WORK=$$(mktemp -d) && \
cd $$WORK && \
$(3) && \
cd / && \
touch $$TARGET && \
rm -rf $$WORK
endef
# Compile a linux binary for a single target in Docker.
define build_linux
$(call run_linux_docker_build,$(call single_target_linux_script,$(1),$(4),$(3)),$(2))
endef
else ifeq ($(OS),Linux)
# Build a linux binary in a temp directory.
define build_in_temp
@SOURCE=$(CURDIR)/$(1) && \
TARGET=$(CURDIR)/$(2) && \
WORK=$$(mktemp -d) && \
cd $$WORK && \
$(3) && \
cd / && \
rm -rf $$WORK
endef
# Compile a linux binary for a single target.
define build_linux
$(call single_target_linux_script,$(1),$(4),$(3))
endef
endif

# Run the correct shasum command for the current OS, extracting just the checksum.
ifeq ($(OS),Darwin)
define sha
$(shell shasum -a $(1) $(2) | cut -d' ' -f1)
endef
sha256 = shasum -a 256
else ifeq ($(OS),Linux)
define sha
$(shell sha$(1)sum $(2) | cut -d' ' -f1)
endef
sha256 = sha256sum
endif

# Verify a checksum against a known value, creating a stamp.
define verify_checksum
if [ "$(1)" = "$(2)" ]; then \
	echo "checksum match for $(3)"; \
	touch $(4); \
else \
	echo "checksum mismatch for $(3)"; \
	exit 1; \
fi
endef

# Download a file, ensuring the destination directory exists.
define download
@mkdir -p $(dir $(2))
@curl -fsSLo $(2) $(1)
endef

# Obtain the OS from a system string, e.g. "linux" from "aarch64_linux".
define get_os
$(lastword $(subst _, ,$(1)))
endef

# Obtain the arch from a system string, e.g. "aarch64" from "aarch64_linux".
define get_arch
$(if $(findstring x86_64,$(1)),x86_64,$(if $(findstring aarch64,$(1)),aarch64,$(word 1,$(subst _, ,$(1)))))
endef

# Targets that just list other targets.
NULL :=
SPACE := $(NULL) $(NULL)
define \n


endef
define spaces_to_lines
$(subst $(SPACE),$(\n),$(1))
endef

.PHONY: list list_all
list list_all:
	$(info $(call spaces_to_lines,$(ALL_HOST_COMPONENTS)))
	@:

ifeq ($(OS),Darwin)
.PHONY: list_cross_targets
list_cross_targets:
	$(info $(call spaces_to_lines,$(ALL_PLATFORM_TARGETS)))
	@:

.PHONY: list_all_platforms
list_all_platforms:
	$(info $(call spaces_to_lines,$(sort $(ALL_HOST_COMPONENTS) $(ALL_PLATFORM_TARGETS))))
	@:
endif

# https://stackoverflow.com/a/26339924/7163088
.PHONY: list_all_targets
list_all_targets:
	@LC_ALL=C $(MAKE) -pRrq -f $(firstword $(MAKEFILE_LIST)) : 2>/dev/null | awk -v RS= -F: '/(^|\n)# Files(\n|$$)/,/(^|\n)# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | grep -E -v -e '^[^[:alnum:]]' -e '^$@$$'
# Docker image

ifeq ($(OS),Darwin)
.PHONY: docker_images
docker_images: $(BUILDDIR)/docker_images.stamp

.PHONY: docker_stopall
docker_stopall:
	@docker container stop $(shell docker container ls -q --filter name=tangram-bootstrap) 2>/dev/null || true
	@docker buildx stop tangram_bootstrap_builder 2>/dev/null || true

.PHONY: clean_docker
clean_docker: docker_stopall
	@docker rmi tangram_bootstrap_x86_64 2>/dev/null || true
	@docker rmi tangram_bootstrap_aarch64 2>/dev/null || true
	$(stop_builder)
	@rm -rfv $(BUILDDIR)/docker_images.stamp

define DOCKERFILE
FROM alpine:3.19
RUN apk update
RUN apk add alpine-sdk autoconf automake bash binutils bison build-base file flex gawk gcc gcompat gettext-tiny git grep help2man indent m4 libbz2 libgcc libtool linux-headers ncurses ncurses-dev openssl-dev python3 wget xz zlib-dev zlib-static
CMD ["/bin/bash"]
endef

export DOCKERFILE

$(BUILDDIR)/docker_images.stamp:
	$(stop_builder)
	@docker buildx create --use --platform linux/amd64,linux/arm64  --name tangram_bootstrap_builder
	@docker buildx inspect --bootstrap
	@echo "$$DOCKERFILE" | docker buildx build --platform linux/amd64 --load -t tangram_bootstrap_x86_64 -f - .
	@echo "$$DOCKERFILE" | docker buildx build --platform linux/arm64 --load -t tangram_bootstrap_aarch64 -f - .
	$(stop_builder)
	@mkdir -p $(@D) && touch $@

define stop_builder
@docker buildx stop tangram_bootstrap_builder 2>/dev/null || true
@docker buildx rm tangram_bootstrap_builder 2>/dev/null || true
endef

# Run a script in a Docker container.
define run_linux_docker_build
docker run \
	--rm \
	--platform linux/$(2) \
	--name "tangram-bootstrap-$(@F)-$(notdir $(@D))" \
	-v "$$PWD:/bootstrap" \
	tangram_bootstrap_$(2) \
	bash -eu -o pipefail -c \
	'$(1)'
endef
else
$(BUILDDIR)/docker_images.stamp:
	@echo "Skipping Docker image build on Linux"
	@mkdir -p $(@D) && touch $@
endif
