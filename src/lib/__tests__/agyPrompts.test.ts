import { readFileSync } from 'fs';
import { join } from 'path';

import { agentSpec } from '../herdr/agents';
import { optionKeys, parseBlockedPrompt } from '../transcript/blockedPrompt';

/** Screens read off Antigravity CLI 1.3.6 with `herdr pane read --source visible`, the folder renamed. */
const screen = (name: string) => readFileSync(join(__dirname, 'fixtures/screens', `${name}.txt`), 'utf8');
const answers = { submitWithEnter: agentSpec('agy')?.digitAnswers !== true };

describe('Antigravity prompts', () => {
  it('reads a permission: the command, and every option whole across its wrap', () => {
    const prompt = parseBlockedPrompt(screen('agy-permission'));
    expect(prompt.question).toBe('Run this command?');
    expect(prompt.details).toMatchObject({ title: 'Command', body: ['echo herdrchat-probe'] });
    expect(prompt.options.map((option) => option.label)).toEqual([
      'Yes, run command',
      "Yes, and always allow in this conversation for commands that start with 'echo'",
      "Yes, and always allow for commands that start with 'echo' (Persist to settings.json)",
      'No, cancel',
    ]);
    // The digit alone answers; an Enter after it would land in the composer.
    expect(optionKeys(prompt.options[0]!, answers)).toEqual(['1']);
  });

  it('reads a question', () => {
    const prompt = parseBlockedPrompt(screen('agy-question'));
    expect(prompt.question).toBe('Question 1/1: Which colour would you like to use?');
    expect(prompt.options.map((option) => option.label)).toEqual(['Blue', 'Red', 'Green', 'Write-in...']);
    expect(optionKeys(prompt.options[1]!, answers)).toEqual(['2']);
  });

  it('reads the trust question, named for Antigravity, answered with the arrows', () => {
    const prompt = parseBlockedPrompt(screen('agy-trust'));
    expect(prompt.question).toBe('Trust /home/dev/projects/agy-probe? Antigravity CLI will be able to read, edit and run files there.');
    expect(prompt.options.map((option) => [option.label, optionKeys(option, answers)])).toEqual([
      ['Yes, I trust this folder', ['Enter']],
      ['No, exit', ['Down', 'Enter']],
    ]);
  });
});
