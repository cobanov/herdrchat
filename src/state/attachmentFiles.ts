import { Directory, File, Paths } from 'expo-file-system';

import { imageName } from '@/lib/transcript/images';

/**
 * The phone's copies of the pictures it sent, named like the host files. A
 * bubble finds its thumbnail from the path in the transcript alone; a picture
 * sent from elsewhere has no copy here and shows as a plain label.
 */
export function attachmentsFolder(): Directory {
  const folder = new Directory(Paths.document, 'attachments');
  folder.create({ idempotent: true, intermediates: true });
  return folder;
}

/** The phone's copy of a sent picture, or null when this phone did not send it. */
export function localImageUri(path: string): string | null {
  if (path.length === 0) return null;
  try {
    const copy = new File(Paths.document, 'attachments', imageName(path));
    return copy.exists ? copy.uri : null;
  } catch {
    return null;
  }
}

/** Deletes every copy. Best effort: a copy that will not go is only a thumbnail. */
export function clearAttachmentCopies(): void {
  try {
    const folder = new Directory(Paths.document, 'attachments');
    if (folder.exists) folder.delete();
  } catch {
    // Nothing to report: the next send recreates the folder.
  }
}
