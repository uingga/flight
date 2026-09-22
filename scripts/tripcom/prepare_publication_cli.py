"""Offline stdin adapter for the existing central Node writer process."""
import json
import sys
from tripcom_publication import prepare_publication

if sys.platform == 'win32':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')

if __name__ == '__main__':
    value = json.load(sys.stdin)
    json.dump(prepare_publication(value['cache'], value['artifact']), sys.stdout, ensure_ascii=False)
