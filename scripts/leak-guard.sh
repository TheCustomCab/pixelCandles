#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Leak guard: stop site-specific details (addresses, network names, ...) from being committed.
#
#   scripts/leak-guard.sh         check the files staged for commit (what the pre-commit hook runs)
#   scripts/leak-guard.sh --all   check every tracked file (run before publishing)
#
# Blocks:
#   - private IPv4 addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
#   - MAC addresses (six hex pairs separated by : or -)
#   - every value in the ```leakguard block of site.local.md (case-insensitive; see site.example.md)
#   - staging site.local.md or any *.local.* file
# A line containing "leak-guard: allow" is skipped (use sparingly, for deliberate examples).
# Exit status: 0 clean, 1 leaks found, 2 usage error.
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "leak-guard: not in a git repository" >&2; exit 2; }
cd "$root" || exit 2

mode=staged
case "${1:-}" in
  --all) mode=all ;;
  "") ;;
  *) echo "usage: $0 [--all]" >&2; exit 2 ;;
esac

values=$(mktemp) || exit 2
trap 'rm -f "$values"' EXIT
if [ -f site.local.md ]; then
  awk '/^```leakguard/{f=1; next} /^```/{f=0} f' site.local.md \
    | sed -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//' | grep -v -e '^$' -e '^#' > "$values"
else
  echo "leak-guard: no site.local.md, checking only private IPs and MAC addresses" >&2
fi

private_ip='(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9.]|$)'
mac='(^|[^0-9A-Fa-f:-])([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}([^0-9A-Fa-f:-]|$)'

if [ "$mode" = all ]; then
  files=$(git ls-files)
else
  files=$(git diff --cached --name-only --diff-filter=ACMR)
fi

found=0
report() { echo "  $1:$2"; found=1; }
content() { if [ "$mode" = all ]; then cat -- "$1"; else git show ":$1"; fi; }

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    site.local.md|*.local.*|*.local) echo "  $f: private file must not be committed"; found=1; continue ;;
  esac
  [ "$mode" = all ] && [ ! -f "$f" ] && continue
  # Skip binary files (grep -I treats them as non-matching).
  content "$f" | grep -qI . 2>/dev/null || continue
  hits=$(
    { content "$f" | grep -nIE "$private_ip" | sed 's/^/private IP: /'
      content "$f" | grep -nIE "$mac" | sed 's/^/MAC address: /'
      [ -s "$values" ] && content "$f" | grep -nIiF -f "$values" | sed 's/^/site value: /'
    } | grep -v 'leak-guard: allow'
  )
  if [ -n "$hits" ]; then
    echo "$f"
    printf '%s\n' "$hits" | sed 's/^/  /' | cut -c1-200
    found=1
  fi
done <<< "$files"

if [ "$found" -ne 0 ]; then
  echo
  echo "leak-guard: site-specific details found (see above). Replace them with placeholders such as"
  echo "<CONTROLLER_IP> and keep the real values in site.local.md. Commit blocked."
  exit 1
fi
[ "$mode" = all ] && echo "leak-guard: all tracked files clean"
exit 0
