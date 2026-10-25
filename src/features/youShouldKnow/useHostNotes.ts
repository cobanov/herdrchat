import { useMemo } from 'react';

import { useOtherHosts } from '@/features/chats/useHostChats';
import { byNewest, chatFor, type Note, type NoteChat } from '@/lib/youShouldKnow/notes';
import { useConnections, useSelectedConnection } from '@/state/connections';
import { useYouShouldKnow, type HostNotes } from '@/state/youShouldKnow';

/** One note and where it lives. */
export interface HostNote {
  note: Note;
  connectionId: string;
  hostName: string;
  /** The listed chat whose session it is for, or null: another session on that computer. */
  chat: NoteChat | null;
}

/** A host's notes, or none for a host without "You should know" (or not looked at yet). */
const notesHeld = (entry: HostNotes | undefined): Note[] =>
  entry === undefined || entry.path === null || entry.file === null ? [] : entry.file.notes;

/** The notes of the given hosts, newest first. */
export function useHostNotesOf(connectionIds: readonly string[]): HostNote[] {
  const connections = useConnections((state) => state.connections);
  const byConnection = useYouShouldKnow((state) => state.byConnection);
  return useMemo(() => connectionIds.flatMap((connectionId) => {
    const entry = byConnection[connectionId];
    const hostName = connections.find((connection) => connection.id === connectionId)?.name ?? '';
    return notesHeld(entry).map((note): HostNote => ({ note, connectionId, hostName, chat: chatFor(note, entry?.chats ?? []) }));
  }).sort((a, b) => byNewest(a.note, b.note)), [connectionIds, connections, byConnection]);
}

/** The notes for the chats' bar, over the hosts the list lists, newest first. Needs no host's name. */
export function useNotesOf(connectionIds: readonly string[]): Note[] {
  const byConnection = useYouShouldKnow((state) => state.byConnection);
  return useMemo(
    () => connectionIds.flatMap((connectionId) => notesHeld(byConnection[connectionId])).sort(byNewest),
    [connectionIds, byConnection]
  );
}

/**
 * Every listed host's notes, for the notes screen: the selected host's and
 * each other host whose chats join its list, as the chat list lists them.
 */
export function useAllNotes(): { notes: HostNote[]; connectionIds: readonly string[] } {
  const selected = useSelectedConnection();
  const others = useOtherHosts(selected?.id ?? null);
  const ids = useMemo(() => (selected === null ? [] : [selected.id, ...others.map((host) => host.id)]), [selected, others]);
  const notes = useHostNotesOf(ids);
  return { notes, connectionIds: ids };
}
