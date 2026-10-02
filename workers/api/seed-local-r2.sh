#!/usr/bin/env bash
# Copies the live beta data into wrangler dev's local R2 (bucket binding: poliaule-data)
set -euo pipefail
cd "$(dirname "$0")"
SRC=poliaule-data-beta
DST=poliaule-data
TMP=$(mktemp -d)
copy() {
  npx wrangler r2 object get "$SRC/$1" --remote --file "$TMP/f.json" >/dev/null
  npx wrangler r2 object put "$DST/$1" --local --file "$TMP/f.json" >/dev/null
  echo "copied $1"
}
copy occupancy/list.json
copy opening-hours.json
copy classrooms.json
npx wrangler r2 object get "$SRC/occupancy/list.json" --remote --file "$TMP/list.json" >/dev/null
for d in $(node -e 'console.log(require(process.argv[1]).dates.join(" "))' "$TMP/list.json"); do
  copy "occupancy/occupation_$d.json"
done
