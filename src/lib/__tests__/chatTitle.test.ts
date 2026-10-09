import { chatTitle, sameName, titleAgent, titledBySession } from '../chatTitle';
import type { AgentInfo } from '../herdr/models';

const parts = {
  sessionTitle: 'Feke animation smoothness',
  agentName: 'feke-pm',
  workspaceLabel: 'feke',
  workspaceId: 'w3',
};

describe('chatTitle', () => {
  it('is the session title first', () => {
    expect(chatTitle(parts)).toBe('Feke animation smoothness');
  });

  it('is the agent name without a session title', () => {
    expect(chatTitle({ ...parts, sessionTitle: null })).toBe('feke-pm');
  });

  it('is the workspace label without either', () => {
    expect(chatTitle({ ...parts, sessionTitle: null, agentName: null })).toBe('feke');
  });

  it('is the workspace id without a label', () => {
    expect(chatTitle({ sessionTitle: null, agentName: null, workspaceLabel: null, workspaceId: 'w3' })).toBe('w3');
  });

  it('is empty when nothing names the chat', () => {
    expect(chatTitle({ sessionTitle: null, agentName: undefined, workspaceLabel: '', workspaceId: null })).toBe('');
  });

  // Blank is empty after a trim, at every rank.
  it('passes over blank candidates', () => {
    expect(chatTitle({ ...parts, sessionTitle: '   ' })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: '', agentName: ' \t' })).toBe('feke');
    expect(chatTitle({ sessionTitle: ' ', agentName: '', workspaceLabel: '  ', workspaceId: 'w3' })).toBe('w3');
  });

  it('trims the title it picks, and cuts nothing', () => {
    const long = 'A long conversation title that wraps onto a second line in the row';
    expect(chatTitle({ ...parts, sessionTitle: `  ${long}  ` })).toBe(long);
    expect(chatTitle({ ...parts, sessionTitle: null, agentName: ' feke-pm\n' })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: null, agentName: null, workspaceLabel: ' feke ' })).toBe('feke');
  });

  // herdr titles the terminal with the agent's name until Claude sets its own.
  it('shows a session title that is just the agent name', () => {
    expect(chatTitle({ ...parts, sessionTitle: 'feke-pm' })).toBe('feke-pm');
  });

  // A starting or resumed session titles the terminal with its command or its
  // id, as the host's notifier also knows.
  it('passes over a session title that is a command or a session id', () => {
    expect(chatTitle({ ...parts, sessionTitle: 'claude --resume 1b2c3d4e-0000-4000-8000-000000000000' })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: '1b2c3d4e-0000-4000-8000-000000000000' })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: '\\claude' })).toBe('feke-pm');
  });
});

describe('titledBySession', () => {
  it('is true when the session or its agent names the chat', () => {
    expect(titledBySession({ sessionTitle: 'Mac app DMG', agentName: null })).toBe(true);
    expect(titledBySession({ sessionTitle: null, agentName: 'caret-a' })).toBe(true);
  });
  it('is false when only the workspace can', () => {
    expect(titledBySession({ sessionTitle: '  ', agentName: null })).toBe(false);
    expect(titledBySession({ sessionTitle: undefined, agentName: undefined })).toBe(false);
  });
});

describe('titleAgent', () => {
  const agentIn = (paneId: string, agent: string | null): AgentInfo => ({
    agent, agentStatus: 'idle', cwd: '/home/demo', foregroundCwd: null, focused: false, paneId, tabId: 't1',
    terminalId: null, workspaceId: 'w1', agentSession: null, stateChangeSeq: null, completionSeq: null,
    inputPending: false, name: null, title: `title of ${paneId}`,
  });

  it('is the one conversational agent, beside any shells', () => {
    expect(titleAgent([agentIn('p0', null), agentIn('p1', 'claude')])?.paneId).toBe('p1');
  });
  // A workspace of several agents stands for all of them, so keeps its label.
  it('is nobody with several conversational agents, or none', () => {
    expect(titleAgent([agentIn('p1', 'claude'), agentIn('p2', 'codex')])).toBeNull();
    expect(titleAgent([agentIn('p0', null), agentIn('p1', 'letta')])).toBeNull();
    expect(titleAgent([])).toBeNull();
  });
});

describe('sameName', () => {
  it('matches a label and a folder ignoring case and space', () => {
    expect(sameName('herdrchat', 'HerdrChat')).toBe(true);
    expect(sameName(' api ', 'api')).toBe(true);
  });
  it('tells different names apart, and never matches nothing', () => {
    expect(sameName('api', 'web')).toBe(false);
    expect(sameName('', '')).toBe(false);
    expect(sameName(null, undefined)).toBe(false);
  });
});
