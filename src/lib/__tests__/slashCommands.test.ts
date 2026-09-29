import { CLAUDE_COMMANDS, commandSuggestions, isSlashCommand } from '../slashCommands';

describe('slash commands', () => {
  it.each(['/model', '/effort high', '  /compact ', '/agent-skills:review 42'])('treats %s as a command', (text) => {
    expect(isSlashCommand(text)).toBe(true);
  });

  it.each(['/Users/me/file.txt', 'hi /model', '/', '/ model', '//x', '/9lives'])('leaves %s a prompt', (text) => {
    expect(isSlashCommand(text)).toBe(false);
  });

  it('offers the commands that start with what was typed', () => {
    expect(commandSuggestions('/', CLAUDE_COMMANDS)).toHaveLength(CLAUDE_COMMANDS.length);
    expect(commandSuggestions('/c', CLAUDE_COMMANDS).map((command) => command.name)).toEqual(['compact', 'context', 'clear']);
    expect(commandSuggestions('/CO', CLAUDE_COMMANDS).map((command) => command.name)).toEqual(['compact', 'context']);
  });

  it('gets out of the way once the name is done', () => {
    expect(commandSuggestions('/model', CLAUDE_COMMANDS)).toEqual([]);
    expect(commandSuggestions('/effort ', CLAUDE_COMMANDS)).toEqual([]);
    expect(commandSuggestions('hello', CLAUDE_COMMANDS)).toEqual([]);
    expect(commandSuggestions('/zz', CLAUDE_COMMANDS)).toEqual([]);
  });
});
