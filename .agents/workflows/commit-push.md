---
description: Git 커밋 & 푸시 (자동 실행)
---

// turbo-all

1. 변경된 파일을 모두 스테이징합니다.
```bash
git add -A
```

2. 변경 내용을 확인합니다.
```bash
git status --short
```

3. 적절한 커밋 메시지로 커밋합니다.
```bash
git commit -m "<변경 내용 요약>"
```

4. 리모트와 동기화 후 푸시합니다.
```bash
git pull --rebase && git push
```
