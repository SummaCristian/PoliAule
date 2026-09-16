#!/bin/sh
# build-beta.sh - runs only in the beta Cloudflare Pages deployment

echo "Beta build: swapping icons..."

cp public/favicons/beta/favicon-96x96.png public/favicons/main/favicon-96x96.png
cp public/favicons/beta/favicon.svg public/favicons/main/favicon.svg
cp public/favicons/beta/favicon.ico public/favicons/main/favicon.ico
cp public/favicons/beta/apple-touch-icon.png public/favicons/main/apple-touch-icon.png
cp public/favicons/beta/web-app-manifest-192x192.png public/favicons/main/web-app-manifest-192x192.png
cp public/favicons/beta/web-app-manifest-512x512.png public/favicons/main/web-app-manifest-512x512.png
cp public/favicons/beta/site.webmanifest public/favicons/main/site.webmanifest

echo "Beta icons in place."

echo "Beta build: pointing config.js at the beta API..."

cat > config.js << 'EOF'
// API base URL. Overwritten for the beta build by scripts/build-beta.sh.
export const API_BASE = 'https://api-beta.poliaule.com';
EOF

echo "Beta API base in place."