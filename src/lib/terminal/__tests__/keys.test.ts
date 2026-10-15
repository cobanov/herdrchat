import { ACCESSORY_KEYS, controlCode, encodeKey } from '../keys';

const ESC = '\u001b';

describe('encodeKey', () => {
  it('sends Esc and Tab as themselves', () => {
    expect(encodeKey({ key: 'escape' })).toBe(ESC);
    expect(encodeKey({ key: 'tab' })).toBe('\t');
  });

  it('sends the arrows as CSI sequences, and SS3 in application cursor mode', () => {
    expect(encodeKey({ key: 'up' })).toBe(`${ESC}[A`);
    expect(encodeKey({ key: 'down' })).toBe(`${ESC}[B`);
    expect(encodeKey({ key: 'right' })).toBe(`${ESC}[C`);
    expect(encodeKey({ key: 'left' })).toBe(`${ESC}[D`);
    expect(encodeKey({ key: 'up' }, {}, { applicationCursor: true })).toBe(`${ESC}OA`);
  });

  it('sends Home and End as xterm does', () => {
    expect(encodeKey({ key: 'home' })).toBe(`${ESC}[H`);
    expect(encodeKey({ key: 'end' })).toBe(`${ESC}[F`);
    expect(encodeKey({ key: 'home' }, {}, { applicationCursor: true })).toBe(`${ESC}OH`);
    expect(encodeKey({ key: 'pageUp' })).toBe(`${ESC}[5~`);
    expect(encodeKey({ key: 'pageDown' }, { control: true })).toBe(`${ESC}[6;5~`);
  });

  it('puts the modifiers in the parameter of a cursor key', () => {
    expect(encodeKey({ key: 'left' }, { control: true })).toBe(`${ESC}[1;5D`);
    expect(encodeKey({ key: 'left' }, { alt: true })).toBe(`${ESC}[1;3D`);
    expect(encodeKey({ key: 'end' }, { control: true, alt: true })).toBe(`${ESC}[1;7F`);
  });

  it('turns Ctrl and a letter into its control code, Ctrl-C into ETX', () => {
    expect(encodeKey({ char: 'c' }, { control: true })).toBe('\u0003');
    expect(encodeKey({ char: 'C' }, { control: true })).toBe('\u0003');
    expect(encodeKey({ char: 'a' }, { control: true })).toBe('\u0001');
    expect(encodeKey({ char: 'z' }, { control: true })).toBe('\u001a');
  });

  it('sends Alt as an Esc in front', () => {
    expect(encodeKey({ char: 'b' }, { alt: true })).toBe(`${ESC}b`);
    expect(encodeKey({ char: 'x' }, { control: true, alt: true })).toBe(`${ESC}\u0018`);
    expect(encodeKey({ key: 'escape' }, { alt: true })).toBe(`${ESC}${ESC}`);
  });

  it("sends the bar's characters as they are", () => {
    for (const char of ['/', '-', '|', '~']) expect(encodeKey({ char })).toBe(char);
    expect(encodeKey({ char: '' })).toBe('');
  });

  it('speaks the kitty keyboard protocol when asked', () => {
    expect(encodeKey({ key: 'escape' }, {}, { kitty: true })).toBe(`${ESC}[27u`);
    expect(encodeKey({ key: 'tab' }, {}, { kitty: true })).toBe('\t');
    expect(encodeKey({ key: 'tab' }, { control: true }, { kitty: true })).toBe(`${ESC}[9;5u`);
    expect(encodeKey({ char: 'C' }, { control: true }, { kitty: true })).toBe(`${ESC}[99;5u`);
    expect(encodeKey({ key: 'up' }, {}, { kitty: true })).toBe(`${ESC}[A`);
  });
});

describe('controlCode', () => {
  it("maps xterm's punctuation and the bar's own characters", () => {
    expect(controlCode('@')).toBe('\u0000');
    expect(controlCode(' ')).toBe('\u0000');
    expect(controlCode('[')).toBe(ESC);
    expect(controlCode('\\')).toBe('\u001c');
    expect(controlCode('|')).toBe('\u001c');
    expect(controlCode(']')).toBe('\u001d');
    expect(controlCode('~')).toBe('\u001e');
    expect(controlCode('/')).toBe('\u001f');
    expect(controlCode('-')).toBe('\u001f');
    expect(controlCode('?')).toBe('\u007f');
    expect(controlCode('é')).toBe('é');
  });
});

describe('ACCESSORY_KEYS', () => {
  it('has every key the bar promises, each once', () => {
    const ids = ACCESSORY_KEYS.map((key) => key.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'esc', 'tab', 'ctrl', 'alt', 'up', 'down', 'left', 'right', 'slash', 'dash', 'pipe', 'tilde', 'home', 'end',
    ]));
  });

  it('makes Ctrl and Alt modifiers that send nothing themselves', () => {
    const modifiers = ACCESSORY_KEYS.filter((key) => key.modifier !== undefined);
    expect(modifiers.map((key) => key.modifier).sort()).toEqual(['alt', 'control']);
    expect(modifiers.every((key) => key.press === null)).toBe(true);
    expect(ACCESSORY_KEYS.filter((key) => key.modifier === undefined).every((key) => key.press !== null)).toBe(true);
  });
});
