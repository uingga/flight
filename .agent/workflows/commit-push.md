---
description: Git 커밋 & 푸시 (자동 실행)
---
// turbo-all

1. Stage all changes
```
git add -A
```

2. Commit with message
```
git commit -m "<commit message>"
```

3. Pull with rebase and push
```
$env:GIT_EDITOR='true'; git pull --rebase; git push
```
