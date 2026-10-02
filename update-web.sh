#!/usr/bin/env bash
# Copy the dashboard files you test locally (../aiangel-pod/dashboard/web) into this repo, so
# the next commit and push rebuilds the RunPod image with them.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../aiangel-pod/dashboard/web"
[ -d "$src" ] || { echo "not found: $src" >&2; exit 1; }
rm -rf "$here/dashboard/web"
mkdir -p "$here/dashboard"
cp -r "$src" "$here/dashboard/web"
git -C "$here" status --short dashboard/web
