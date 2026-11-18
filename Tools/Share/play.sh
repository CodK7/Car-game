#!/bin/sh
# macOS / Linux: needs python3 (preinstalled on most systems).
cd "$(dirname "$0")/game" || exit 1
URL="http://127.0.0.1:8080/"
echo "Wahiba Sands Off-Road -> $URL  (Ctrl+C to stop)"
( sleep 1; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") ) &
exec python3 -m http.server 8080 --bind 127.0.0.1
