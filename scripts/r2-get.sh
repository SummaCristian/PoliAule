#!/usr/bin/env bash
# Downloads one object from R2 with `wrangler r2 object get`, retrying on
# transient failures (R2 sometimes answers 500). A missing object isn't
# retried. Exits non-zero when it gave up, so callers can fall back; the
# target file is only written when the download succeeded (wrangler would
# otherwise leave an empty file behind).
#
# Usage: r2-get.sh <bucket/key> --file <path>
#
# R2_GET_ATTEMPTS (default 4: the first try plus 3 retries)
# R2_GET_WAIT     (default 90 seconds between attempts)
set -u

key="$1"; shift
dest=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) dest="$2"; shift 2 ;;
    *) echo "r2-get.sh: unexpected argument $1" >&2; exit 64 ;;
  esac
done
[ -n "$dest" ] || { echo "r2-get.sh: --file is required" >&2; exit 64; }

attempts="${R2_GET_ATTEMPTS:-4}"
wait_s="${R2_GET_WAIT:-90}"
tmp="$dest.part"

for ((i = 1; i <= attempts; i++)); do
  out=$(npx --yes wrangler@4 r2 object get "$key" --file "$tmp" --remote 2>&1)
  status=$?
  if [ $status -eq 0 ]; then
    echo "$out"
    mv "$tmp" "$dest"
    exit 0
  fi
  echo "$out" >&2
  if grep -qiE "specified key does not exist|NoSuchKey|10007" <<<"$out"; then
    echo "R2 object $key doesn't exist." >&2
    exit 2
  fi
  if ((i < attempts)); then
    echo "::warning::R2 download of $key failed (attempt $i/$attempts), retrying in ${wait_s}s" >&2
    sleep "$wait_s"
  fi
done

echo "::warning::R2 download of $key failed after $attempts attempts, giving up" >&2
exit 1
