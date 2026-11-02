#!/bin/sh
# Builds the Chrome Web Store zip: only the files the extension runs on, without the downloads permission (it only serves
# saving reports in the unpacked copy; popup.js and content.js hide that when it's missing).
cd "$(dirname "$0")" || exit 1
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' manifest.json)
out="dist/internet-autocorrect-$version.zip"
tmp=$(mktemp -d)
mkdir -p dist
rm -f "$out"
cp -R manifest.json background.js content.js policy.js engine.js copyfix.js clipboard.js ai.js scorer.js offscreen.html model vendor \
  popup.html popup.css popup.js popup-tabs.js backup.html backup.js welcome.html welcome.css welcome.js data icons "$tmp"
sed -i '' '/"downloads",/d' "$tmp/manifest.json"
(cd "$tmp" && zip -q -X -r "$OLDPWD/$out" . -x '*.DS_Store')
rm -rf "$tmp"
echo "$out"
