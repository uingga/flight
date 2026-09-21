import unittest
from tripcom_transport import Client, create_server


class TransportTests(unittest.TestCase):
    def test_nonloopback_and_redirect_targets_refused(self):
        for url in ('http://0.0.0.0/tripcom','http://192.168.1.2/tripcom',
                    'http://127.0.0.1/tripcom?redirect=1','http://user@127.0.0.1/tripcom'):
            with self.assertRaises(ValueError):
                Client(url,'x'*32)

    def test_loopback_client_has_no_proxy(self):
        client = Client('http://127.0.0.1:12345/tripcom','x'*32)
        self.assertEqual(client.url,'http://127.0.0.1:12345/tripcom')
