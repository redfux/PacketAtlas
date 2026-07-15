#!/bin/sh
# Starts a local static web server for PacketAtlas and opens it in the browser.
# Double-click this file in Finder (macOS) to run it.
# thought up by human, created by ai

cd "$(dirname "$0")"
PORT=3459
URL="http://localhost:$PORT"

echo "PacketAtlas wird unter $URL bereitgestellt ..."
echo "Zum Beenden dieses Fenster schliessen oder Strg+C druecken."

( sleep 1 && open "$URL" ) &
python3 -m http.server "$PORT"
