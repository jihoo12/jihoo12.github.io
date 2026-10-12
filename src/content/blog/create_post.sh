#!/usr/bin/env bash
set -euo pipefail

read -r -p "Post title (e.g. My first post): " INPUT_TITLE
TITLE="${INPUT_TITLE:-My first post}"

read -r -p "Post description: " INPUT_DESC
DESC="${INPUT_DESC:-$TITLE}"

PUB_DATE=$(date +"%Y-%m-%d")
FILE_NAME=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-').md

cat > "$FILE_NAME" << EOF
---
title: "$TITLE"
description: "$DESC"
pubDate: $PUB_DATE
---

Write your post here.
EOF

echo "Created post: $FILE_NAME"