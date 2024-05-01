# This file defines the bootstrapping distribution build for the LLVM SDK.
# Adapted from the example in the LLVM documentation: https://github.com/llvm/llvm-project/blob/main/clang/cmake/caches/DistributionExample.cmake
# In addition to the basic example this build uses the LLVM libc++, compiler-rt, and libunwind in both stages.

#  Enable LLVM projects and runtimes
set(LLVM_ENABLE_PROJECTS "clang;clang-tools-extra;lld" CACHE STRING "")
set(LLVM_ENABLE_RUNTIMES "compiler-rt;libcxx;libcxxabi;libunwind" CACHE STRING "")

# Only build the native target in stage1 since it is a throwaway build.
set(LLVM_TARGETS_TO_BUILD Native CACHE STRING "")

# Optimize the stage1 compiler, but don't LTO it because that wastes time.
set(CMAKE_BUILD_TYPE Release CACHE STRING "")

# Setup vendor-specific settings.
set(PACKAGE_VENDOR Tangram CACHE STRING "")

# Setting up the stage2 LTO option needs to be done on the stage1 build so that the proper LTO library dependencies can be connected.
set(BOOTSTRAP_LLVM_ENABLE_LTO ON CACHE BOOL "")

if (NOT APPLE)
  # Since LLVM_ENABLE_LTO is ON we need a LTO capable linker
  set(BOOTSTRAP_LLVM_ENABLE_LLD ON CACHE BOOL "")
endif()

# Configure the stage1 and 2 builds to both use LLVM components, avoiding dependencies on the build toolchain.
set(CLANG_DEFAULT_CXX_STDLIB "libc++" CACHE STRING "")
set(BOOTSTRAP_CLANG_DEFAULT_CXX_STDLIB "libc++" CACHE STRING "")
set(CLANG_DEFAULT_RTLIB "compiler-rt" CACHE STRING "")
set(BOOTSTRAP_CLANG_DEFAULT_RTLIB "compiler-rt" CACHE STRING "")

set(LIBCXX_USE_COMPILER_RT ON CACHE BOOL "")
set(BOOTSTRAP_LIBCXX_USE_COMPILER_RT ON CACHE BOOL "")

set(LIBCXXABI_USE_COMPILER_RT ON CACHE BOOL "")
set(BOOTSTRAP_LIBCXXABI_USE_COMPILER_RT ON CACHE BOOL "")
set(LIBCXXABI_USE_LLVM_UNWINDER ON CACHE BOOL "")
set(BOOTSTRAP_LIBCXXABI_USE_LLVM_UNWINDER ON CACHE BOOL "")

set(LIBUNWIND_USE_COMPILER_RT ON CACHE BOOL "")
set(BOOTSTRAP_LIBUNWIND_USE_COMPILER_RT ON CACHE BOOL "")

# Ensure we build a static libc++abi library in stage 1.
set(LIBCXX_ENABLE_STATIC_ABI_LIBRARY ON CACHE BOOL "")

# Set up LLVM to handle static builds.
# see https://github.com/ClangBuiltLinux/tc-build/issues/150#issuecomment-1005053204
set(LLVM_BUILD_STATIC ON CACHE BOOL "")
set(LLVM_ENABLE_PIC OFF CACHE BOOL "")
set(LLVM_ENABLE_LIBXML2 OFF CACHE BOOL "")
set(LLVM_ENABLE_ZLIB OFF CACHE BOOL "")
set(LLVM_ENABLE_TERMINFO OFF CACHE BOOL "")
set(CMAKE_EXE_LINKER_FLAGS "-static" CACHE STRING "")
set(BOOTSTRAP_CMAKE_EXE_LINKER_FLAGS "-static -unwindlib=libunwind" CACHE STRING "")
set(BOOTSTRAP_CMAKE_SHARED_LINKER_FLAGS "-unwindlib=libunwind" CACHE STRING "")

# Install libraries to lib
set(CMAKE_INSTALL_LIBDIR lib CACHE STRING "")

# Skip the rpath install step, as the Tangram ld proxy may have made this impossible for some targets, and circumvents the need.
set(CMAKE_SKIP_INSTALL_RPATH ON CACHE BOOL "")

# Expose stage2 targets through the stage1 build configuration.
set(CLANG_BOOTSTRAP_TARGETS
  check-all
  check-llvm
  check-clang
  llvm-config
  test-suite
  test-depends
  llvm-test-depends
  clang-test-depends
  distribution
  install-distribution
  clang CACHE STRING "")

# Setup the bootstrap build.
set(CLANG_ENABLE_BOOTSTRAP ON CACHE BOOL "")

if(STAGE2_CACHE_FILE)
  set(CLANG_BOOTSTRAP_CMAKE_ARGS
    -C ${STAGE2_CACHE_FILE}
    CACHE STRING "")
else()
  set(CLANG_BOOTSTRAP_CMAKE_ARGS
    -C ${CMAKE_CURRENT_LIST_DIR}/Distribution-stage2.cmake
    CACHE STRING "")
endif()
