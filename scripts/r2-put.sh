#!/usr/bin/env bash
# Uploads one file to R2 with `wrangler r2 object put`, retrying when it fails.
# R2 uploads sometimes fail for no lasting reason, so rather than rerunning the
# whole job, wait and try again; after the last attempt, exit non-zero.
#
# Usage: r2-put.sh <bucket/key> --file <path> --content-type <type>
# (every argument is passed through to wrangler; --remote is added)
#
# R2_PUT_ATTEMPTS (default 4: the first try plus 3 retries)
# R2_PUT_WAIT     (default 90 seconds between attempts)
set -u

attempts="${R2_PUT_ATTEMPTS:-4}"
wait_s="${R2_PUT_WAIT:-90}"

for ((i = 1; i <= attempts; i++)); do
  if npx --yes wrangler@4 r2 object put "$@" --remote; then
    exit 0
  fi
  if ((i < attempts)); then
    echo "::warning::R2 upload of $1 failed (attempt $i/$attempts), retrying in ${wait_s}s" >&2
    sleep "$wait_s"
  fi
done

echo "::error::R2 upload of $1 failed after $attempts attempts" >&2
exit 1
