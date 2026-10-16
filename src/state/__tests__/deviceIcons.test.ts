import { parseDeviceIcons } from '../deviceIcons';

jest.mock('../db', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));

describe('parseDeviceIcons', () => {
  it('reads the saved glyph of each host and machine', () => {
    expect(parseDeviceIcons('{"srv-1":"macmini","srv-1/laptop":"laptopcomputer"}')).toEqual({
      'srv-1': 'macmini',
      'srv-1/laptop': 'laptopcomputer',
    });
  });

  it('drops a glyph the app does not offer, and anything that is not a map', () => {
    expect(parseDeviceIcons('{"srv-1":"rocket","srv-2":"house"}')).toEqual({ 'srv-2': 'house' });
    expect(parseDeviceIcons('["macmini"]')).toEqual({});
    expect(parseDeviceIcons('not json')).toEqual({});
    expect(parseDeviceIcons(null)).toEqual({});
  });
});
