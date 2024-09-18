cmake_minimum_required(VERSION 3.10)
project(DemoProject VERSION 1.0)

# Specify C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add executable
add_executable(test src/main.cpp)

# Install the target
install(TARGETS test
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}  # This installs the executable
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}  # For shared libraries
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}  # For static libraries
)
