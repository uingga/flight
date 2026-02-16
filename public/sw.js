// 서비스 워커 - 웹 푸시 알림 수신
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || '✈️ 티킷 가격 알림';
    const options = {
        body: data.body || '조건에 맞는 항공권이 발견되었습니다!',
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        tag: data.tag || 'price-alert',
        data: { url: data.url || '/' },
        actions: [
            { action: 'open', title: '확인하기' },
            { action: 'dismiss', title: '닫기' },
        ],
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'dismiss') return;
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
