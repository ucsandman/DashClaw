import threading
import time
import unittest

from dashclaw.client import DashClaw, DashClawError


class AuditClient(DashClaw):
    def __init__(self, responses=None):
        super().__init__('https://example.test', 'test-key', 'agent-1')
        self.responses = responses or {}
        self.calls = []

    def _request(self, path, method='GET', body=None, params=None, json_payload=None, **kwargs):
        payload = kwargs.get('json', json_payload if json_payload is not None else body)
        effective_path = path
        if params:
            query = '&'.join(f'{key}={str(value).lower() if isinstance(value, bool) else value}' for key, value in params.items())
            effective_path = f'{path}?{query}'
        self.calls.append((effective_path, method, payload))
        response = self.responses.get((method, effective_path), {'ok': True})
        if callable(response):
            return response(payload)
        if isinstance(response, Exception):
            raise response
        return response


class TestAuditRunGoverned(unittest.TestCase):
    def test_completion_report_loss_is_not_recorded_as_callback_failure(self):
        outcome_calls = []

        def outcome_response(payload):
            outcome_calls.append(payload)
            if payload['status'] == 'completed':
                raise RuntimeError('completion response lost')
            return {'ok': True}

        client = AuditClient({
            ('POST', '/api/guard?record=true'): {
                'decision': 'allow', 'recorded': True, 'action_id': 'act_1'
            },
            ('PATCH', '/api/actions/act_1'): lambda body: {
                'claimed': True, 'action_id': 'act_1', 'attempt_id': body['attempt_id']
            },
            ('POST', '/api/actions/act_1/outcome'): outcome_response,
        })
        callback_calls = []

        with self.assertRaises(Exception) as ctx:
            client.run_governed(
                {'kind': 'shell', 'command': 'deploy-safe-fixture'},
                {'action_type': 'deploy', 'declared_goal': 'deploy fixture'},
                lambda: callback_calls.append('ran') or 'done',
            )

        self.assertEqual(callback_calls, ['ran'])
        self.assertEqual(outcome_calls, [{'status': 'completed'}])
        self.assertEqual(ctx.exception.__class__.__name__, 'OutcomeConfirmationError')
        self.assertEqual(ctx.exception.action_id, 'act_1')

    def test_claims_exact_scrubbed_act_before_callback(self):
        client = AuditClient({
            ('POST', '/api/guard?record=true'): {
                'decision': 'allow', 'recorded': True, 'action_id': 'act_1'
            },
            ('PATCH', '/api/actions/act_1'): lambda body: {
                'claimed': True, 'action_id': 'act_1', 'attempt_id': body['attempt_id']
            },
        })
        callback_calls = []

        client.run_governed(
            {'kind': 'shell', 'command': 'echo token=oc_live_fixture'},
            {
                'action_type': 'other',
                'declared_goal': 'run fixture',
                'client_capabilities': ['custom'],
            },
            lambda: callback_calls.append('ran'),
        )

        guard_payload = next(body for path, _, body in client.calls if path == '/api/guard?record=true')
        claim_payload = next(body for path, _, body in client.calls if path == '/api/actions/act_1')
        self.assertEqual(guard_payload['client_capabilities'], ['custom', 'execution_claims'])
        self.assertEqual(claim_payload['act']['command'], 'echo token=[REDACTED]')
        self.assertEqual(claim_payload['agent_id'], 'agent-1')
        self.assertTrue(claim_payload['claim_execution'])
        self.assertEqual(callback_calls, ['ran'])

    def test_mismatched_claim_confirmation_does_not_execute(self):
        client = AuditClient({
            ('POST', '/api/guard?record=true'): {
                'decision': 'allow', 'recorded': True, 'action_id': 'act_1'
            },
            ('PATCH', '/api/actions/act_1'): {
                'claimed': True, 'action_id': 'act_OTHER', 'attempt_id': 'wrong'
            },
        })
        callback_calls = []

        with self.assertRaises(Exception) as ctx:
            client.run_governed(
                {'kind': 'shell', 'command': 'echo safe'},
                {'action_type': 'other', 'declared_goal': 'run fixture'},
                lambda: callback_calls.append('ran'),
            )

        self.assertEqual(ctx.exception.__class__.__name__, 'ExecutionClaimError')
        self.assertEqual(ctx.exception.action_id, 'act_1')
        self.assertEqual(callback_calls, [])

    def test_lost_claim_response_is_not_retried_or_executed(self):
        client = AuditClient({
            ('POST', '/api/guard?record=true'): {
                'decision': 'allow', 'recorded': True, 'action_id': 'act_1'
            },
            ('PATCH', '/api/actions/act_1'): DashClawError('not found', status=404),
        })
        callback_calls = []

        with self.assertRaises(Exception) as ctx:
            client.run_governed(
                {'kind': 'shell', 'command': 'echo safe'},
                {'action_type': 'other', 'declared_goal': 'run fixture'},
                lambda: callback_calls.append('ran'),
            )

        claim_calls = [call for call in client.calls if call[0] == '/api/actions/act_1']
        self.assertEqual(len(claim_calls), 1)
        self.assertEqual(callback_calls, [])
        self.assertEqual(ctx.exception.__class__.__name__, 'ExecutionClaimError')
        self.assertEqual(ctx.exception.action_id, 'act_1')
        self.assertIn('upgrade DashClaw', str(ctx.exception))


class ConcurrentWaitClient(DashClaw):
    def __init__(self):
        super().__init__('https://example.test', 'test-key', 'agent-1')
        self.sse_started = threading.Event()
        self.release_sse = threading.Event()
        self.get_action_calls = 0

    def _connect_sse(self, action_id, timeout):
        self.sse_started.set()
        self.release_sse.wait(0.3)
        return None

    def get_action(self, action_id):
        self.get_action_calls += 1
        return {'action': {'action_id': action_id, 'status': 'running', 'approved_by': 'operator-1'}}


class TestConcurrentApprovalReconciliation(unittest.TestCase):
    def test_authoritative_poll_resolves_while_sse_is_still_open(self):
        client = ConcurrentWaitClient()
        started = time.monotonic()
        try:
            result = client.wait_for_approval('act_1', timeout=2, interval=0.01)
        finally:
            client.release_sse.set()

        self.assertTrue(client.sse_started.is_set())
        self.assertLess(time.monotonic() - started, 0.2)
        self.assertEqual(result['action']['approved_by'], 'operator-1')
        self.assertGreaterEqual(client.get_action_calls, 1)


if __name__ == '__main__':
    unittest.main()
