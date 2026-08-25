#!/usr/bin/env node
/**
 * 배포 안전장치 — 배포 전 되돌아갈 지점을 표시하고, 문제 발생 시 코드만 되돌린다.
 *
 *   npm run deploy:mark              배포 직전 "안전 지점" 태그 생성 + 푸시
 *   npm run deploy:list              저장된 안전 지점 목록
 *   npm run deploy:rollback          가장 최근 안전 지점의 코드로 되돌리기
 *   npm run deploy:rollback safe/... 특정 안전 지점으로 되돌리기
 *
 * 되돌릴 때 data/ 는 건드리지 않는다. 항공권 데이터는 GitHub Actions가 하루 7회
 * 자동 갱신하므로, 코드를 되돌리면서 데이터까지 과거로 되감으면 안 되기 때문이다.
 */

import { execSync } from 'node:child_process';

const TAG_PREFIX = 'safe/';

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
}

function shLive(cmd) {
    execSync(cmd, { stdio: 'inherit' });
}

function fail(msg) {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

function assertCleanTree() {
    // 추적 중인 파일만 검사한다. 별도 작업의 untracked 파일은 롤백 대상도,
    // 커밋 대상도 아니므로 그대로 보존한다.
    if (sh('git status --porcelain --untracked-files=no')) {
        fail('추적 중인 파일에 커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 되돌린 뒤 다시 실행하세요.\n   확인: git status');
    }
}

function safeTags() {
    const out = sh(`git tag -l "${TAG_PREFIX}*" --sort=-creatordate`);
    return out ? out.split('\n').filter(Boolean) : [];
}

function latestSafeTag() {
    const tags = safeTags();
    if (tags.length === 0) {
        fail(`안전 지점이 없습니다. 배포 전에 먼저 실행하세요:\n   npm run deploy:mark`);
    }
    return tags[0];
}

// ── mark ────────────────────────────────────────────────
function cmdMark(label) {
    const dirtyTree = sh('git status --porcelain');
    if (dirtyTree) {
        console.warn('\n⚠️ 커밋되지 않은 변경은 안전 지점에 포함되지 않습니다.');
        console.warn('   현재 배포된 HEAD만 되돌아갈 지점으로 기록합니다.\n');
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const tag = `${TAG_PREFIX}${stamp}`;

    if (safeTags().includes(tag)) {
        fail(`같은 이름의 안전 지점이 이미 있습니다: ${tag} (1분 뒤 다시 시도하세요)`);
    }

    const head = sh('git rev-parse --short HEAD');
    const subject = sh('git log -1 --format=%s');
    const message = label ? `배포 전 안전 지점: ${label}` : '배포 전 안전 지점';

    shLive(`git tag -a ${tag} -m "${message.replace(/"/g, "'")}"`);
    try {
        shLive(`git push origin ${tag}`);
    } catch {
        shLive(`git tag -d ${tag}`);
        fail('태그 푸시 실패 — 로컬 태그를 되돌렸습니다. 네트워크/권한을 확인하세요.');
    }

    console.log(`\n✅ 안전 지점 생성: ${tag}`);
    console.log(`   기준 커밋: ${head} ${subject}`);
    console.log(`\n   문제가 생기면 되돌리기:  npm run deploy:rollback\n`);
}

// ── list ────────────────────────────────────────────────
function cmdList() {
    const tags = safeTags();
    if (tags.length === 0) {
        console.log('\n저장된 안전 지점이 없습니다.\n  배포 전에 실행하세요: npm run deploy:mark\n');
        return;
    }
    console.log('\n=== 안전 지점 목록 (최신순) ===\n');
    for (const tag of tags) {
        const info = sh(`git log -1 --format="%ci|%h|%s" ${tag}`);
        const [date, hash, subject] = info.split('|');
        console.log(`  ${tag}`);
        console.log(`     ${date}  ${hash}  ${subject}`);
    }
    console.log(`\n  되돌리기: npm run deploy:rollback ${tags[0]}\n`);
}

// ── rollback ────────────────────────────────────────────
function cmdRollback(requestedTag) {
    assertCleanTree();

    const tag = requestedTag || latestSafeTag();
    if (!safeTags().includes(tag)) {
        fail(`'${tag}' 는 존재하지 않는 안전 지점입니다.\n   목록 확인: npm run deploy:list`);
    }

    const changed = sh(`git diff --name-only ${tag}..HEAD -- . ":(exclude)data"`);
    if (!changed) {
        console.log(`\n✅ ${tag} 이후 코드 변경이 없습니다. 되돌릴 것이 없습니다.\n`);
        return;
    }

    console.log(`\n되돌릴 대상: ${tag} 이후의 코드 변경`);
    console.log(changed.split('\n').map((f) => `  - ${f}`).join('\n'));
    console.log('\n(data/ 는 최신 상태로 유지됩니다)\n');

    // 되돌리기 방식: git revert(커밋별 재생)는 중간의 대용량 data/ 커밋에서
    // 충돌해 실패할 수 있다. 안전망 자체가 실패하면 안 되므로, 충돌이 원천
    // 불가능한 방식을 쓴다 — data/ 를 제외한 모든 파일을 안전 지점의 내용으로
    // 직접 덮어쓴 뒤, 그 이후 새로 추가된(코드) 파일만 삭제한다.
    try {
        // 1) tag 시점에 존재하던 non-data 파일을 그 시점 내용으로 복원 (수정/삭제 원복)
        shLive(`git checkout ${tag} -- . ":(exclude)data"`);

        // 2) tag 이후 새로 추가된 non-data 파일 제거 (git checkout은 지우지 못함)
        const added = sh(`git diff --diff-filter=A --name-only ${tag}..HEAD -- . ":(exclude)data"`);
        if (added) {
            for (const file of added.split('\n').filter(Boolean)) {
                shLive(`git rm -q -- "${file}"`);
            }
        }
    } catch {
        // 부분 적용된 변경을 원상복구해 작업 트리를 깨끗하게 되돌린다
        try { sh('git reset --hard HEAD'); } catch { /* 무시 */ }
        fail('자동 되돌리기 실패. 작업 트리를 원래대로 되돌렸습니다.\n   수동 확인이 필요합니다.');
    }

    if (!sh('git diff --cached --name-only')) {
        console.log('\n✅ 되돌릴 코드 변경이 없습니다 (이미 안전 지점과 동일).\n');
        return;
    }

    shLive(`git commit -m "revert: ${tag} 시점 코드로 롤백 (data/ 제외)"`);

    console.log(`\n✅ 로컬에서 ${tag} 시점 코드로 되돌렸습니다.`);
    console.log('\n   배포에 반영하려면:  git push');
    console.log('   되돌리기를 취소하려면:  git reset --hard HEAD~1\n');
}

// ── entry ───────────────────────────────────────────────
const [, , command, arg] = process.argv;

switch (command) {
    case 'mark':
        cmdMark(arg);
        break;
    case 'list':
        cmdList();
        break;
    case 'rollback':
        cmdRollback(arg);
        break;
    default:
        console.log(`
배포 안전장치

  npm run deploy:mark [설명]        배포 전 안전 지점 표시
  npm run deploy:list               안전 지점 목록
  npm run deploy:rollback [태그]    코드를 안전 지점으로 되돌리기 (data/ 제외)
`);
        process.exit(command ? 1 : 0);
}
