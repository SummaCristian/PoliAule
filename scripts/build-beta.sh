#!/bin/sh
# build-beta.sh - runs only in the beta Cloudflare Pages deployment

echo "Beta build: swapping icons..."

cp favicons/beta/favicon-96x96.png favicons/main/favicon-96x96.png
cp favicons/beta/favicon.svg favicons/main/favicon.svg
cp favicons/beta/favicon.ico favicons/main/favicon.ico
cp favicons/beta/apple-touch-icon.png favicons/main/apple-touch-icon.png
cp favicons/beta/web-app-manifest-192x192.png favicons/main/web-app-manifest-192x192.png
cp favicons/beta/web-app-manifest-512x512.png favicons/main/web-app-manifest-512x512.png
cp favicons/beta/site.webmanifest favicons/main/site.webmanifest

echo "Beta icons in place."