#!/usr/bin/env bash
# Copy the dashboard files you test locally (../aiangel-pod/dashboard/web) into this repo, so
# the next commit and push rebuilds the RunPod image with them.
#
# It stops instead when the copy would lose work that is only in this repo: a file the local
# folder does not have (story.js was written here first), or an index.html without a tab this one
# has. Bring those over to ../aiangel-pod first, or pass --force to copy anyway.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../aiangel-pod/dashboard/web"
dest="$here/dashboard/web"
[ -d "$src" ] || { echo "not found: $src" >&2; exit 1; }
if [ "${1:-}" != "--force" ] && [ -d "$dest" ]; then
    lost=()
    for f in "$dest"/*; do
        [ -e "$src/$(basename "$f")" ] || lost+=("$(basename "$f")")
    done
    for tab in $(grep -o 'data-tab="[a-z]*"' "$dest/index.html" | sort -u); do
        grep -q "$tab" "$src/index.html" || lost+=("index.html loses the ${tab#data-tab=} tab")
    done
    if [ ${#lost[@]} -gt 0 ]; then
        echo "not copying: ../aiangel-pod/dashboard/web is behind this repo:" >&2
        printf '  %s\n' "${lost[@]}" >&2
        echo "copy this repo's dashboard/web there first, or run with --force" >&2
        exit 1
    fi
fi
rm -rf "$dest"
mkdir -p "$here/dashboard"
cp -r "$src" "$dest"
git -C "$here" status --short dashboard/web
