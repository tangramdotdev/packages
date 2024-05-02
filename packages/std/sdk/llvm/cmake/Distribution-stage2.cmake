# This file defines the stage2 of the distribution build for the LLVM SDK.
# Adapted from the example in the LLVM documentation: https://github.com/llvm/llvm-project/blob/main/clang/cmake/caches/DistributionExample-stage2.cmake

set(LLVM_ENABLE_PROJECTS "clang;clang-tools-extra;lld" CACHE STRING "")
set(LLVM_ENABLE_RUNTIMES "compiler-rt;libcxx;libcxxabi;libunwind" CACHE STRING "")

set(LLVM_TARGETS_TO_BUILD X86;ARM;AArch64 CACHE STRING "")

set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O3 -gline-tables-only -DNDEBUG" CACHE STRING "")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O3 -gline-tables-only -DNDEBUG" CACHE STRING "")

# Ensure the profiling feature of compiler-rt is included.
set(COMPILER_RT_BUILD_PROFILE ON CACHE BOOL "")

# setup toolchain
set(LLVM_INSTALL_TOOLCHAIN_ONLY ON CACHE BOOL "")
set(LLVM_TOOLCHAIN_TOOLS
  dsymutil
  llvm-ar
  llvm-cov
  llvm-dwarfdump
  llvm-nm
  llvm-objcopy
  llvm-objdump
  llvm-profdata
  llvm-readobj
  llvm-size
  llvm-strip
  llvm-strings
  CACHE STRING "")

set(LLVM_DISTRIBUTION_COMPONENTS
  clang
  lld
  LTO
  clang-format
  clang-resource-headers
  builtins
  runtimes
  ${LLVM_TOOLCHAIN_TOOLS}
  CACHE STRING "")

set(LLVM_INSTALL_BINUTILS_SYMLINKS ON CACHE BOOL "")
