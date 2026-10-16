import { useState } from 'react';

import { showActionSheet } from '@/components/ActionSheet';
import {
  clipboardHasImage,
  MAX_ATTACHMENTS,
  pasteAttachment,
  pickAttachments,
  type Attachment,
} from '@/features/thread/attachments';
import { errorText } from '@/lib/herdr/protocol';

/**
 * Pictures for the composer, from the library or the clipboard, or why not.
 * Out of the hook because the React Compiler skips a function holding a
 * try/catch with a conditional in it, and the thread screen renders the whole
 * thread.
 */
async function gatherAttachments(source: 'library' | 'paste', room: number): Promise<{ ready: Attachment[] } | { error: string }> {
  try {
    const added = source === 'library' ? await pickAttachments(room) : [await pasteAttachment()];
    return { ready: added.filter((item): item is Attachment => item !== null) };
  } catch (thrown) {
    return { error: `Couldn't add the picture: ${errorText(thrown)}` };
  }
}

/**
 * Pictures waiting to go with the next message. They stay until a send is
 * taken, so a failed upload leaves them in place with the draft.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const addAttachments = async (source: 'library' | 'paste') => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    setPreparing(true);
    setAttachError(null);
    const gathered = await gatherAttachments(source, room);
    if ('error' in gathered) setAttachError(gathered.error);
    else if (gathered.ready.length > 0) setAttachments((previous) => [...previous, ...gathered.ready].slice(0, MAX_ATTACHMENTS));
    setPreparing(false);
  };
  // Straight to the library, unless the clipboard holds a picture to paste.
  const offerAttachment = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`A message can carry ${MAX_ATTACHMENTS} pictures.`);
      return;
    }
    if (!(await clipboardHasImage())) {
      await addAttachments('library');
      return;
    }
    showActionSheet({
      title: 'Add a picture',
      actions: [
        { label: 'Photo Library', onPress: () => void addAttachments('library') },
        { label: 'Paste Picture', onPress: () => void addAttachments('paste') },
      ],
    });
  };
  return {
    attachments,
    preparing,
    attachError,
    dismissAttachError: () => setAttachError(null),
    addAttachments,
    offerAttachment,
    removeAttachment: (name: string) => setAttachments((previous) => previous.filter((item) => item.name !== name)),
    clearAttachments: () => setAttachments([]),
  };
}
