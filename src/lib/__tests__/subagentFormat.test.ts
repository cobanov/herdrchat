import { formatDuration, formatTokens, formatToolCalls } from '../subagents/format';

describe('a delegation card figures', () => {
  it('says how long an agent ran the way a person would', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(48_200)).toBe('48s');
    expect(formatDuration(66_000)).toBe('1m 6s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(3_720_000)).toBe('1h 2m');
    expect(formatDuration(7_200_000)).toBe('2h');
  });

  it('counts tokens in thousands past a thousand', () => {
    expect(formatTokens(null)).toBeNull();
    expect(formatTokens(1)).toBe('1 token');
    expect(formatTokens(940)).toBe('940 tokens');
    expect(formatTokens(21_450)).toBe('21.5k tokens');
    expect(formatTokens(17_000)).toBe('17k tokens');
    expect(formatTokens(1_240_000)).toBe('1.2M tokens');
  });

  it('counts tool calls', () => {
    expect(formatToolCalls(null)).toBeNull();
    expect(formatToolCalls(1)).toBe('1 tool call');
    expect(formatToolCalls(6)).toBe('6 tool calls');
  });
});
