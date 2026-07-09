read -p "포스트 제목을 입력하세요 (예: my first post): " INPUT_TITLE
TITLE="${INPUT_TITLE:-my first post}"

read -p "포스트 설명을 입력하세요: " INPUT_DESC
DESC="${INPUT_DESC:-$TITLE}"

PUB_DATE=$(date +"%b %e %Y" | tr 'A-Z' 'a-z')

FILE_NAME=$(echo "$TITLE" | tr ' ' '-' | tr 'A-Z' 'a-z').md

# 5. 템플릿 내용 작성
cat << EOF > "$FILE_NAME"
---
title: "$TITLE"
description: "$DESC"
pubDate: $PUB_DATE
---

post content
EOF

echo "----------------------------------------"
echo "🎉 성공적으로 포스트가 생성되었습니다: $FILE_NAME"
echo "----------------------------------------"
