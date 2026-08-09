import { copyOptions } from '../messageCopy';
import type { ChatMessage } from '../transcript/message';

const message = (text: string): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  segments: [{ kind: 'text', text }],
  timestamp: 0,
  agentLabel: null,
  isSidechain: false,
});

describe('copyOptions', () => {
  it('returns the whole message as written', () => {
    expect(copyOptions(message('Run it and see.')).full).toBe('Run it and see.');
  });

  it('has no code option when the message has no code', () => {
    // The case that matters: offering "Copy code" here would put an empty string
    // on the clipboard and silently wipe whatever was there.
    expect(copyOptions(message('Just prose, no fences.')).code).toBeNull();
  });

  it('extracts a fenced block without its fences', () => {
    const text = 'Try this:\n\n```bash\nnpm test\n```\n\nThen look at the output.';
    expect(copyOptions(message(text)).code).toBe('npm test');
  });

  it('joins several code blocks with a blank line', () => {
    const text = '```sh\ncd repo\n```\n\nthen\n\n```sh\nnpm ci\n```';
    expect(copyOptions(message(text)).code).toBe('cd repo\n\nnpm ci');
  });

  it('ignores an empty fenced block', () => {
    // An agent mid-stream can emit an opened fence with nothing in it yet.
    expect(copyOptions(message('```\n\n```')).code).toBeNull();
  });

  it('keeps indentation inside a block', () => {
    const text = '```py\ndef f():\n    return 1\n```';
    expect(copyOptions(message(text)).code).toBe('def f():\n    return 1');
  });

  it('ignores tool chips and thinking, which are not the message', () => {
    const withMachinery: ChatMessage = {
      ...message('Done.'),
      segments: [
        { kind: 'thinking', text: 'considering' },
        { kind: 'toolUse', name: 'Bash', input: 'rm -rf /' },
        { kind: 'text', text: 'Done.' },
      ],
    };
    const options = copyOptions(withMachinery);
    expect(options.full).toBe('Done.');
    expect(options.full).not.toContain('rm -rf');
  });
});
