import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { newImageName, type OutgoingImage } from '@/lib/attachments/upload';
import { attachmentsFolder } from '@/state/attachmentFiles';

/**
 * Pictures chosen for a message, ready to send.
 *
 * Each is scaled down and re-encoded as JPEG on the phone: a screenshot or a
 * photo straight from the camera roll is several megabytes, and the agent reads
 * a 2048px picture as well as a 4000px one. The phone keeps a copy under the
 * same name the host file gets, which is how a bubble finds its thumbnail from
 * nothing but the path in the transcript.
 */
export interface Attachment extends OutgoingImage {
  /** The phone's copy, for the thumbnail. */
  uri: string;
}

/** Pictures one message can carry. */
export const MAX_ATTACHMENTS = 4;
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.8;

async function prepare(source: string, width: number, height: number): Promise<Attachment> {
  const context = ImageManipulator.manipulate(source);
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
  const name = newImageName();
  const copy = new File(attachmentsFolder(), name);
  if (!copy.exists) copy.create();
  copy.write(saved.base64 ?? '', { encoding: 'base64' });
  return { name, base64: saved.base64 ?? '', uri: copy.uri };
}

/** Pictures from the library, at most `limit`. Empty when the picker is dismissed. */
export async function pickAttachments(limit: number): Promise<Attachment[]> {
  if (limit <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, limit).map((asset) => prepare(asset.uri, asset.width, asset.height)));
}

/** Whether the clipboard holds a picture, for offering "Paste". */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

/** The picture on the clipboard, or null when there is none. */
export async function pasteAttachment(): Promise<Attachment | null> {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 1 });
  if (image === null) return null;
  return prepare(image.data, image.size.width, image.size.height);
}
