import { connectionRecovery } from '../connectionRecovery';

it.each([
  ['auth_failed', 'credentials'],
  ['bad_key', 'credentials'],
  ['connect_failed', 'address'],
  ['herdr_not_found', 'install'],
  ['herdr_not_on_path', 'path'],
  ['herdr_not_executable', 'path'],
  ['server_not_running', 'start'],
  ['timeout', 'retry'],
])('offers the matching recovery for %s', (code, action) => {
  expect(connectionRecovery(code).action).toBe(action);
});
