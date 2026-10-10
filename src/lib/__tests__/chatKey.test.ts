import { chatKey } from '../chatKey';

it('keys the workspace chat by its bare id, so markers written before panes still match', () => {
  expect(chatKey({ workspaceId: 'w1' })).toBe('w1');
  expect(chatKey({ workspaceId: 'w1', paneId: null })).toBe('w1');
  expect(chatKey({ workspaceId: 'w1', paneId: '' })).toBe('w1');
});

it('keys a pane chat under its workspace, apart from the workspace chat and its sibling', () => {
  expect(chatKey({ workspaceId: 'w1', paneId: 'w1:p2' })).toBe('w1/w1:p2');
  expect(chatKey({ workspaceId: 'w1', paneId: 'w1:p2' })).not.toBe(chatKey({ workspaceId: 'w1', paneId: 'w1:p1' }));
  expect(chatKey({ workspaceId: 'w1', paneId: 'w1:p2' })).not.toBe(chatKey({ workspaceId: 'w1' }));
});
