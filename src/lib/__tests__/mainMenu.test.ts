import { buildSheet } from '../actionSheet';
import { mainMenuActions, mainMenuTitle } from '../mainMenu';

const handlers = () => ({ newChat: jest.fn(), hosts: jest.fn(), settings: jest.fn() });

describe('mainMenuActions', () => {
  it('lists New chat, Hosts and Settings, in that order, with a host selected', () => {
    const actions = mainMenuActions({ hasConnection: true, ...handlers() });
    expect(actions.map((action) => action.label)).toEqual(['New chat', 'Hosts', 'Settings']);
  });

  it('leaves out New chat when there is no host to start one on', () => {
    const actions = mainMenuActions({ hasConnection: false, ...handlers() });
    expect(actions.map((action) => action.label)).toEqual(['Hosts', 'Settings']);
  });

  it('wires each row to its own handler', () => {
    const open = handlers();
    const actions = mainMenuActions({ hasConnection: true, ...open });
    actions.forEach((action) => action.onPress());
    expect(open.newChat).toHaveBeenCalledTimes(1);
    expect(open.hosts).toHaveBeenCalledTimes(1);
    expect(open.settings).toHaveBeenCalledTimes(1);
  });

  it('keeps the shown order once the sheet is built, with Cancel last and nothing red', () => {
    // Every row is safe, so a tap on any of them must never be styled as the
    // one that cannot be undone.
    const sheet = buildSheet(mainMenuActions({ hasConnection: true, ...handlers() }));
    expect(sheet.options).toEqual(['New chat', 'Hosts', 'Settings', 'Cancel']);
    expect(sheet.destructiveButtonIndices).toEqual([]);
  });
});

describe('mainMenuTitle', () => {
  it('names the selected host', () => {
    expect(mainMenuTitle('Kaohsiung')).toBe('Kaohsiung');
  });

  it('falls back to the app name with no host, or a blank one', () => {
    expect(mainMenuTitle(null)).toBe('HerdrChat');
    expect(mainMenuTitle(undefined)).toBe('HerdrChat');
    expect(mainMenuTitle('  ')).toBe('HerdrChat');
  });
});
