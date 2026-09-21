import unittest
from tripcom_worker import execute_worker


class WorkerTests(unittest.TestCase):
    def run_fixture(self, status='collected', fail=None):
        self.calls = []
        ticket = {'slot':'slot', 'host':'B', 'token':'fixture'}
        def call(action, **body):
            self.calls.append(action)
            if action == fail:
                raise RuntimeError('transport_unknown')
            return {'acquire':{'ticket':ticket}, 'check':{'owned':True},
                'block':{'blocked':True}, 'receive':{'artifactHash':'hash','publication':'pending'}}[action]
        def runner(**args):
            args['assert_owner']('slot','B')
            return {'status':status}
        return execute_worker(call=call, slot='slot',host='B',state_root='unused',
            browser_factory=None,close_browser=None,runner=runner)

    def test_success_only_submits_no_publication(self):
        self.assertEqual(self.run_fixture()['publication'], 'pending')
        self.assertEqual(self.calls,['acquire','check','receive'])

    def test_block_persisted_before_receive(self):
        self.run_fixture('blocked')
        self.assertEqual(self.calls,['acquire','check','block','receive'])

    def test_uncertain_block_does_not_continue(self):
        with self.assertRaises(RuntimeError):
            self.run_fixture('blocked','block')
        self.assertEqual(self.calls,['acquire','check','block'])

    def test_uncertain_receive_is_not_retried(self):
        with self.assertRaises(RuntimeError):
            self.run_fixture(fail='receive')
        self.assertEqual(self.calls.count('receive'),1)
