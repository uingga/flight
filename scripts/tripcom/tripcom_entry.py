"""Scheduled worker entry. Installation supplies pinned, local configuration."""
import argparse
import json
import socket
from pathlib import Path
from datetime import datetime
from tripcom_coordinator import KST, SCHEDULE
from tripcom_transport import Client
from tripcom_worker import execute_worker


def scheduled_slot(now, host):
    due = [time for time in SCHEDULE if time <= now.strftime('%H:%M')]
    if not due or SCHEDULE[max(due)] != host:
        raise RuntimeError('no_current_slot_for_host')
    return now.strftime('%Y-%m-%d') + 'T' + max(due) + ':00+09:00'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    if config.get('enabled') is not True:
        raise RuntimeError('installation_not_enabled')
    if config.get('hostname', '').casefold() != socket.gethostname().casefold():
        raise RuntimeError('wrong_installed_host')
    host = config['host']
    if host not in ('B','C'):
        raise RuntimeError('invalid_worker_host')
    profile = Path(config['profile']).resolve(strict=True)
    if not profile.is_dir():
        raise RuntimeError('existing_profile_required')
    token = Path(config['workerTokenFile']).read_text(encoding='utf-8').strip()
    client = Client(config['coordinatorUrl'], token)
    slot = scheduled_slot(datetime.now(KST), host)
    # Import only after config checks. run_admitted opens Chrome only after
    # central and local ownership checks, preserving the original signed-in profile.
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        def browser_factory():
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile), channel='chrome', headless=False,
                locale='ko-KR', viewport={'width':1400,'height':900})
            try:
                page = context.pages[0] if context.pages else context.new_page()
                return context, page
            except BaseException:
                context.close()
                raise
        receipt = execute_worker(call=client, slot=slot, host=host,
            state_root=config['stateRoot'], browser_factory=browser_factory,
            close_browser=lambda context: context.close())
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
