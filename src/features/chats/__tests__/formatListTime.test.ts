import { formatListTime } from '../ChatRow';

// The device's region and 12/24-hour setting decide, not en-US (HC-32).
it('formats a time today in the device locale', () => {
  const spy = jest.spyOn(Date.prototype, 'toLocaleTimeString');
  formatListTime(Date.now());
  expect(spy).toHaveBeenCalledWith(undefined, { hour: '2-digit', minute: '2-digit' });
  spy.mockRestore();
});
