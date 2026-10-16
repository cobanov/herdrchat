import { chatTitle, DEFAULT_TERMINAL_TITLES, isDefaultTerminalTitle, sameName, titleAgent, titledBySession } from '../chatTitle';
import type { AgentInfo } from '../herdr/models';

const parts = {
  sessionTitle: 'Feke animation smoothness',
  agentName: 'feke-pm',
  workspaceLabel: 'feke',
  workspaceId: 'w3',
};

describe('chatTitle', () => {
  // A name someone chose with `herdr agent rename` wins over the one the
  // model wrote.
  it('is the agent name first', () => {
    expect(chatTitle(parts)).toBe('feke-pm');
  });

  it('is the session title without an agent name', () => {
    expect(chatTitle({ ...parts, agentName: null })).toBe('Feke animation smoothness');
    expect(chatTitle({ ...parts, agentName: '  ' })).toBe('Feke animation smoothness');
  });

  // herdr names a workspace after its pane's folder and follows it until
  // someone renames it, so a label naming no folder was given by a person:
  // "herdrchat" for a session Claude titled "NAS'taki steam2 dump dosyası".
  it('is a workspace label someone chose, over the session title', () => {
    const named = { ...parts, agentName: null, workspaceLabel: 'herdrchat', folders: ['/Users/me/Developer'] };
    expect(chatTitle(named)).toBe('herdrchat');
    expect(chatTitle({ ...named, agentName: 'reviewer' })).toBe('reviewer');
  });

  it('keeps the session title over a label herdr gave after the folder', () => {
    const folder = { ...parts, agentName: null, workspaceLabel: 'Developer', folders: ['/Users/me/Developer'] };
    expect(chatTitle(folder)).toBe('Feke animation smoothness');
    // Any pane's folder counts: the label follows whichever pane is focused.
    expect(chatTitle({ ...folder, folders: ['/Users/me/Developer/api', '/Users/me/Developer'] })).toBe('Feke animation smoothness');
    // Without folders nothing tells the two apart, so the session wins as before.
    expect(chatTitle({ ...folder, workspaceLabel: 'herdrchat', folders: undefined })).toBe('Feke animation smoothness');
    expect(chatTitle({ ...folder, workspaceLabel: 'herdrchat', folders: [] })).toBe('Feke animation smoothness');
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
    expect(chatTitle({ ...parts, agentName: '   ' })).toBe('Feke animation smoothness');
    expect(chatTitle({ ...parts, sessionTitle: '', agentName: ' \t' })).toBe('feke');
    expect(chatTitle({ sessionTitle: ' ', agentName: '', workspaceLabel: '  ', workspaceId: 'w3' })).toBe('w3');
  });

  it('trims the title it picks, and cuts nothing', () => {
    const long = 'A long conversation title that wraps onto a second line in the row';
    expect(chatTitle({ ...parts, agentName: null, sessionTitle: `  ${long}  ` })).toBe(long);
    expect(chatTitle({ ...parts, sessionTitle: null, agentName: ' feke-pm\n' })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: null, agentName: null, workspaceLabel: ' feke ' })).toBe('feke');
  });

  // herdr titles the terminal with the agent's name until Claude sets its own.
  it('shows a session title that is just the agent name', () => {
    expect(chatTitle({ ...parts, agentName: null, sessionTitle: 'feke-pm' })).toBe('feke-pm');
  });

  // A starting or resumed session titles the terminal with its command or its
  // id, as the host's notifier also knows.
  it('passes over a session title that is a command or a session id', () => {
    const noName = { ...parts, agentName: null };
    expect(chatTitle({ ...noName, sessionTitle: 'claude --resume 1b2c3d4e-0000-4000-8000-000000000000' })).toBe('feke');
    expect(chatTitle({ ...noName, sessionTitle: '1b2c3d4e-0000-4000-8000-000000000000' })).toBe('feke');
    expect(chatTitle({ ...noName, sessionTitle: '\\claude' })).toBe('feke');
  });
});

// Each agent's terminal title before its session has a topic. On herdr 0.9.3
// a Claude pane's `title` is null, so this is what a fresh chat would read:
// every new chat titled "Claude Code" and alike in the list.
describe('an agent\'s default terminal title', () => {
  const entries = Object.entries(DEFAULT_TERMINAL_TITLES).flatMap(([agent, titles]) =>
    titles.map((title) => [agent, title] as const));

  it('lists Claude Code\'s', () => {
    expect(DEFAULT_TERMINAL_TITLES.claude).toEqual(expect.arrayContaining(['Claude Code', 'claude']));
  });

  it.each(entries)('falls through from %s\'s %p to the agent name, then the workspace', (_agent, title) => {
    expect(chatTitle({ ...parts, sessionTitle: title })).toBe('feke-pm');
    expect(chatTitle({ ...parts, sessionTitle: title, agentName: null })).toBe('feke');
    expect(chatTitle({ sessionTitle: title, agentName: null, workspaceLabel: null, workspaceId: 'w3' })).toBe('w3');
    expect(titledBySession({ sessionTitle: title, agentName: null })).toBe(false);
  });

  // herdr strips the status glyph from `terminal_title_stripped`, but an older
  // herdr, or a spinner it does not know, can leave one in front.
  it('is matched with a status glyph in front, and in any case', () => {
    for (const title of ['✳ Claude Code', '◑ Claude Code', '⠋ Claude Code', 'claude code', '  Claude Code  ', '✳ claude']) {
      expect(isDefaultTerminalTitle(title)).toBe(true);
      expect(chatTitle({ ...parts, sessionTitle: title, agentName: null })).toBe('feke');
    }
  });

  it('leaves a real topic, even one that mentions the agent', () => {
    for (const title of ['Claude Code hooks setup', 'Fix the codex launcher', 'Feke animation smoothness']) {
      expect(isDefaultTerminalTitle(title)).toBe(false);
      expect(chatTitle({ ...parts, sessionTitle: title, agentName: null })).toBe(title);
    }
    expect(isDefaultTerminalTitle(null)).toBe(false);
    expect(isDefaultTerminalTitle('')).toBe(false);
  });
});

describe('titledBySession', () => {
  it('is true when the session or its agent names the chat', () => {
    expect(titledBySession({ sessionTitle: 'Mac app DMG', agentName: null })).toBe(true);
    expect(titledBySession({ sessionTitle: null, agentName: 'caret-a' })).toBe(true);
  });
  it('is false when only the workspace can', () => {
    expect(titledBySession({ sessionTitle: '  ', agentName: null })).toBe(false);
    expect(titledBySession({ sessionTitle: 'Claude Code', agentName: null })).toBe(false);
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
