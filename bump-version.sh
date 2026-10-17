#!/bin/bash
# Sets the app version everywhere it has to appear, so a release bump is one command:
#
#   ./bump-version.sh 1.5.0
#
# Why a script: the page is served as static files (GitHub Pages sends
# `Cache-Control: max-age=600`), and browsers cache every ES module separately.
# After an update a browser could therefore run a NEW app.js against an OLD,
# still-cached data-model.js (or vice versa) and fail with e.g. "does not
# provide an export named ...". Giving every module URL the same `?v=<version>`
# makes the whole file set switch over at once. The query strings are plain
# text in the sources (static `import` statements cannot be templated and the
# CSP forbids inline scripts / import maps), so they are rewritten here.
#
# Touches: APP_VERSION in app.js, every `from './x.js'` import in the top-level
# .js files, and the stylesheet (css/*.css), js/design-system.js and app.js tags
# in index.html. The workers already
# derive their version from APP_VERSION at runtime. releases.md stays manual.
#
# Normally you don't run this yourself: .githooks/pre-commit calls it with the
# APP_VERSION from app.js on every commit (enable once per clone with
# `git config core.hooksPath .githooks`).
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <major.minor.patch>   (e.g. $0 1.5.0)" >&2
  exit 1
fi

perl -pi -e "s/^(const APP_VERSION = ')[^']*(';)/\${1}${version}\${2}/" app.js
perl -pi -e "s#(from '\./[A-Za-z0-9._-]+?\.js)(\?v=[^']*)?'#\${1}?v=${version}'#" ./*.js
perl -pi -e "s#(href=\"css/[A-Za-z0-9._-]+\.css)(\?v=[^\"]*)?\"#\${1}?v=${version}\"#g; s#(src=\"(?:app|js/design-system)\.js)(\?v=[^\"]*)?\"#\${1}?v=${version}\"#g" index.html

echo "Version auf ${version} gesetzt:"
grep -n "const APP_VERSION" app.js
grep -n 'css/.*\.css\|src="app.js\|design-system.js' index.html
echo "Import-Zeilen mit Version: $(grep -c "from '\./.*?v=${version}'" ./*.js | awk -F: '{s+=$2} END {print s}')"
