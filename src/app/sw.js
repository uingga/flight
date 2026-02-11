// Service Worker for Tikit Push Notifications
const CACHE_NAME = 'tikit-v1';

// 알림 표시
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, data } = event.data;
        self.registration.showNotification(title, {
            body,
            icon: '/icon-192.svg',
            badge: '/icon-192.svg',
            data,
            vibrate: [200, 100, 200],
            tag: 'tikit-deal', // 같은 태그면 기존 알림 대체
            renotify: true,
            actions: [
                { action: 'view', title: '보러가기' },
                { action: 'dismiss', title: '닫기' },
            ],
        });
    }
});

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    // 사이트로 이동
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 이미 열린 탭이 있으면 포커스
            for (const client of clientList) {
                if (client.url.includes('mytikit.vercel.app') || client.url.includes('localhost')) {
                    client.focus();
                    return;
                }
            }
            // 없으면 새 탭 열기
            return clients.openWindow('/');
        })
    );
});

// 설치
self.addEventListener('install', () => {
    self.skipWaiting();
});

// 활성화
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});
