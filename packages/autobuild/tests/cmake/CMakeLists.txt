cmake_minimum_required(VERSION 3.10)
project(DemoProject VERSION 1.0)

# Specify C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add executable
add_executable(demo_app src/main.cpp)
