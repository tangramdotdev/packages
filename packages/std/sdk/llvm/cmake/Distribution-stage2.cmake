# This file defines the stage2 of the distribution build for the LLVM SDK.
# Adapted from the example in the LLVM documentation: https://github.com/llvm/llvm-project/blob/main/clang/cmake/caches/DistributionExample-stage2.cmake

set(LLVM_ENABLE_PROJECTS "clang;clang-tools-extra;lld" CACHE STRING "")
set(LLVM_ENABLE_RUNTIMES "compiler-rt;libcxx;libcxxabi;libunwind" CACHE STRING "")

# Set architectures to support.
set(LLVM_TARGETS_TO_BUILD X86;ARM;AArch64 CACHE STRING "")

# Set compiler flags.
set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O3 -gline-tables-only -DNDEBUG" CACHE STRING "")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O3 -gline-tables-only -DNDEBUG" CACHE STRING "")

# Mirror the stage1 configuration to use all LLVM components.
set(CLANG_DEFAULT_CXX_STDLIB "libc++" CACHE STRING "")
set(CLANG_DEFAULT_RTLIB "compiler-rt" CACHE STRING "")
set(LIBCXX_USE_COMPILER_RT ON CACHE BOOL "")
set(LIBCXXABI_USE_COMPILER_RT ON CACHE BOOL "")
set(LIBCXXABI_USE_LLVM_UNWINDER ON CACHE BOOL "")
set(LIBUNWIND_USE_COMPILER_RT ON CACHE BOOL "")

# NOTE - the coresponding CMAKE_EXE_LINKER_FLAGS is set in `llvm.tg.ts`.
set(CMAKE_SHARED_LINKER_FLAGS "-unwindlib=libunwind" CACHE STRING "")

# Set up LLVM configuration.
set(LLVM_ENABLE_EH ON CACHE BOOL "")
set(LLVM_ENABLE_PIC ON CACHE BOOL "")
set(LLVM_ENABLE_RTTI ON CACHE BOOL "")
set(LLVM_ENABLE_LIBEDIT OFF CACHE BOOL "")
set(LLVM_ENABLE_LIBXML2 OFF CACHE BOOL "")
set(CMAKE_INSTALL_LIBDIR lib CACHE STRING "")
set(CMAKE_SKIP_INSTALL_RPATH ON CACHE BOOL "")

# Define toolchain components.
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
