export type RecoveryAction = 'credentials' | 'address' | 'path' | 'install' | 'start' | 'retry';

/** The editor retains the host's error code so each failure has a useful next step. */
export function connectionRecovery(code: string): {
  title: string;
  label: string;
  action: RecoveryAction;
} {
  switch (code) {
    case 'auth_failed':
      return {
        title: 'Authentication was rejected',
        label: 'Review credentials',
        action: 'credentials',
      };
    case 'bad_key':
      return {
        title: 'The private key could not be read',
        label: 'Review private key',
        action: 'credentials',
      };
    case 'connect_failed':
      return {
        title: 'The host could not be reached',
        label: 'Review host and port',
        action: 'address',
      };
    case 'herdr_not_found':
      return {
        title: 'herdr is not installed',
        label: 'Install herdr on the host',
        action: 'install',
      };
    case 'herdr_not_on_path':
    case 'herdr_not_executable':
      return {
        title: 'The herdr path needs attention',
        label: 'Set herdr path',
        action: 'path',
      };
    case 'server_not_running':
      return {
        title: 'herdr is not running',
        label: 'Start herdr on the host',
        action: 'start',
      };
    default:
      return {
        title: 'The connection was interrupted',
        label: 'Try again',
        action: 'retry',
      };
  }
}
