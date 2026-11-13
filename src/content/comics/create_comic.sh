#!/usr/bin/env bash
# Makes a folder for a new comic. Put the page images in it, then list them under `pages`.
set -euo pipefail
cd "$(dirname "$0")"

read -r -p "Comic title (e.g. Nixchan meets a segfault): " INPUT_TITLE
TITLE="${INPUT_TITLE:-Untitled comic}"

read -r -p "One-line description: " INPUT_DESC
DESC="${INPUT_DESC:-$TITLE}"

SLUG=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9가-힣' '-' | sed 's/^-//; s/-$//')
mkdir -p "$SLUG"

cat > "$SLUG/index.md" << EOT
---
title: "$TITLE"
description: "$DESC"
pubDate: $(date +"%Y-%m-%d")
# Images in this folder, top to bottom. Use { src: ./02.png, alt: "what happens" } to describe a page.
pages:
  - ./01.png
# Remove this line when it's ready to publish.
draft: true
---

A note under the comic (optional).
EOT

echo "Created $SLUG/ — drop the page images in it and edit $SLUG/index.md"
