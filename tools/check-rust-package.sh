#!/bin/sh
# Build the packaged crate beside unrelated consumer fixtures.
set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: sh tools/check-rust-package.sh path/to/gencmu-VERSION.crate" >&2
    exit 1
fi
package_directory=$(cd "$(dirname "$1")" && pwd)
package="$package_directory/$(basename "$1")"
crate=$(basename "$package" .crate)
consumer=$(mktemp -d)
trap 'rm -rf "$consumer"' EXIT HUP INT TERM

mkdir -p "$consumer/vendor" "$consumer/src" "$consumer/tests/engine" "$consumer/tests/notation"
tar -xzf "$package" -C "$consumer/vendor"
cat > "$consumer/Cargo.toml" <<EOF
[package]
name = "gencmu-package-consumer"
version = "0.0.0"
edition = "2021"

[dependencies]
gencmu = { path = "vendor/$crate" }
EOF
printf 'fn main() {}\n' > "$consumer/src/main.rs"
for kind in engine notation; do
    printf '{}\n' > "$consumer/tests/$kind/case-a.json"
    printf '{}\n' > "$consumer/tests/$kind/case_a.json"
done

# Use a fresh target directory so Cargo must run the packaged build script.
cd "$consumer"
CARGO_TARGET_DIR="$consumer/target" cargo build --offline
