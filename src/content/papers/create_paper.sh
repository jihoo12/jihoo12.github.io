#!/usr/bin/env bash
# Starts a new paper draft from _template.md.
set -euo pipefail
cd "$(dirname "$0")"

read -r -p "Paper title: " TITLE
[ -n "$TITLE" ] || { echo "A title is needed." >&2; exit 1; }
read -r -p "Written with (e.g. Claude, ChatGPT; empty if none): " WITH
read -r -p "Language [en/ko] (en): " LANG_IN

SLUG=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9가-힣' '-' | sed 's/^-//; s/-$//')
FILE="$SLUG.md"
[ -e "$FILE" ] && { echo "$FILE already exists." >&2; exit 1; }

TITLE_ESC=${TITLE//\"/\\\"}
sed -e "s|^title: .*|title: \"$TITLE_ESC\"|" \
    -e "s|^pubDate: .*|pubDate: $(date +%Y-%m-%d)|" \
    -e "s|^lang: .*|lang: ${LANG_IN:-en}|" \
    -e '/^# Files starting/d' \
    _template.md > "$FILE"
if [ -n "$WITH" ]; then
  sed -i "s|^writtenWith: .*|writtenWith: \"$WITH\"|" "$FILE"
else
  sed -i '/^# The AI that wrote/d; /^writtenWith:/d' "$FILE"
fi

echo "Created $FILE (draft: true until you remove that line)"
