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

echo "Beta build: pointing config.js at the beta API..."

cat > config.js << 'EOF'
// API base URL. Overwritten for the beta build by scripts/build-beta.sh.
export const API_BASE = 'https://api-beta.poliaule.com';
EOF

echo "Beta API base in place."