import { isSlashCommand } from '../slashCommands';

describe('slash commands', () => {
  it.each(['/model', '/effort high', '  /compact ', '/agent-skills:review 42'])('treats %s as a command', (text) => {
    expect(isSlashCommand(text)).toBe(true);
  });

  it.each(['/Users/me/file.txt', 'hi /model', '/', '/ model', '//x', '/9lives'])('leaves %s a prompt', (text) => {
    expect(isSlashCommand(text)).toBe(false);
  });
});
