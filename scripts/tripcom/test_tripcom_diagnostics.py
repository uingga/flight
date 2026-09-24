import unittest
from tripcom_diagnostics import failure_details, stage


class DiagnosticsTests(unittest.TestCase):
    def test_timeout_has_bounded_stage_without_browser_text(self):
        with self.assertRaises(TimeoutError) as caught:
            with stage('outbound_cards_wait'):
                raise TimeoutError('private browser page text')
        result = failure_details(caught.exception)
        self.assertEqual(result['reason'], 'stage_timeout')
        self.assertEqual(result['stage'], 'outbound_cards_wait')
        self.assertNotIn('private browser page text', str(result))

    def test_validation_code_is_retained(self):
        self.assertEqual(failure_details(ValueError('outbound_date_mismatch'))['reason'],
                         'outbound_date_mismatch')


if __name__ == '__main__':
    unittest.main()
