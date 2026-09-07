'use client';

import { useEffect, useState } from 'react';

const ADMIN_KEY_STORAGE = 'tikitikit_admin_key';

export function useAdminAccess(): boolean {
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        let controller: AbortController | undefined;

        const verify = async () => {
            controller?.abort();
            const current = new AbortController();
            controller = current;
            setAuthorized(false);

            try {
                const key = window.localStorage.getItem(ADMIN_KEY_STORAGE);
                if (!key) return;

                const response = await fetch('/api/admin-access', {
                    headers: { 'x-admin-key': key },
                    cache: 'no-store',
                    signal: current.signal,
                });
                const result = response.ok ? await response.json() : null;
                if (!current.signal.aborted) setAuthorized(result?.authorized === true);
            } catch {
                if (!current.signal.aborted) setAuthorized(false);
            }
        };

        const handleStorage = (event: StorageEvent) => {
            if (event.key === ADMIN_KEY_STORAGE || event.key === null) void verify();
        };

        void verify();
        window.addEventListener('focus', verify);
        window.addEventListener('storage', handleStorage);
        return () => {
            controller?.abort();
            window.removeEventListener('focus', verify);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    return authorized;
}
