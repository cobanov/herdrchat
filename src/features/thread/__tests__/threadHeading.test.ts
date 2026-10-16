import { fitParts, statusText, threadHeading } from '../ThreadHeader';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({ useTheme: () => ({ colors: {} }) }));

const thread = (fields: Partial<Parameters<typeof threadHeading>[0]>): Parameters<typeof threadHeading>[0] => ({
  sessionTitle: null, agentName: null, workspaceLabel: null, agents: [], sessionMeta: null, workingDirName: null, ...fields,
});
const none = { title: undefined, paneId: undefined, machineLabel: null, commanded: { model: null, effort: null } };

// HC-112: a chat titled by its folder read "docs", then "docs" again under it.
it('never repeats the title in the line under it', () => {
  const { heading, parts } = threadHeading(thread({ workspaceLabel: 'docs', workingDirName: 'docs' }), none);
  expect(heading).toBe('docs');
  expect(parts).not.toContain('docs');
});

// Seen on a real host: New chat names the workspace and its agent alike.
it('leaves out the workspace when it has the title\'s name', () => {
  const { heading, parts } = threadHeading(thread({ agentName: 'hc-probe', workspaceLabel: 'hc-probe', workingDirName: 'probe-grok' }), none);
  expect(heading).toBe('hc-probe');
  expect(parts).toEqual(['probe-grok']);
});

// HC-113: one line cut to "her… · waiting for reply" or "notes ·…".
describe('the header line on a narrow screen', () => {
  const parts = ['herdrchat', 'Opus 5', 'high effort', 'herdrchat-app'];

  it('keeps the parts that fit whole, the first always', () => {
    expect(fitParts(parts, 'needs you'.length, 1000, 6.6)).toEqual(parts);
    expect(fitParts(parts, 'needs you'.length, 160, 6.6)).toEqual(['herdrchat']);
    expect(fitParts(parts, 'working'.length, 20, 6.6)).toEqual(['herdrchat']);
  });

  it('says a waiting agent needs you, in two words', () => {
    expect(statusText('blocked', false, false)).toBe('needs you');
  });
});
