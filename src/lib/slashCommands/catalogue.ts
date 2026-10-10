/**
 * A host's catalogue as the phone holds it: what scans have found, merged,
 * kept in the settings table (`slashCommands.<connectionId>`) so the palette
 * is complete on the next launch before anything has run.
 *
 * The host-wide part (built-ins, the person's commands and skills, plugins) is
 * one scan per host every so often; projects are scanned per folder, the first
 * time a thread opens on one. A failed scan changes nothing here.
 */
import { CLAUDE_BUILTINS, CODEX_BUILTINS } from './builtins';
import { dedupeCommands, type ScanResult } from './parse';
import type { CatalogueAgent, CatalogueCommand, CommandSection, CommandSource } from './types';

/** Project folders remembered per host, the most recently scanned kept. */
export const MAX_CACHED_PROJECTS = 30;

export interface SlashCatalogueCache {
  version: 1;
  /**
   * `binaryKey` of the binary `builtins` was read from: the signature sent
   * with the next scan, so an unchanged binary is not grepped again. Null when
   * none was read (the static list stands in).
   */
  binary: string | null;
  /** Read from the binary; empty means the static list stands in. */
  builtins: CatalogueCommand[];
  user: CatalogueCommand[];
  plugins: CatalogueCommand[];
  /** By folder, in the order scanned (oldest first). */
  projects: Record<string, CatalogueCommand[]>;
  /** When the host-wide part was last read; null for never. */
  hostScannedAt: number | null;
}

export function emptyCatalogueCache(): SlashCatalogueCache {
  return { version: 1, binary: null, builtins: [], user: [], plugins: [], projects: {}, hostScannedAt: null };
}

/** The cache after a scan. Parts the scan did not read are kept as they were. */
export function applyScan(cache: SlashCatalogueCache, scan: ScanResult, now: number): SlashCatalogueCache {
  const next: SlashCatalogueCache = { ...cache, projects: { ...cache.projects } };
  if (scan.builtins?.kind === 'read') {
    next.builtins = scan.builtins.commands;
    // Kept even when the read found nothing, so a bundle the grep no longer
    // understands is not grepped again on every scan; the static list stands in.
    next.binary = scan.binary ?? null;
  }
  if (scan.user !== null) next.user = scan.user;
  if (scan.plugins !== null) next.plugins = scan.plugins;
  if (scan.user !== null || scan.plugins !== null) next.hostScannedAt = now;
  for (const [cwd, commands] of Object.entries(scan.projects)) {
    // Delete first so a folder scanned again moves to the newest end.
    delete next.projects[cwd];
    next.projects[cwd] = commands;
  }
  const folders = Object.keys(next.projects);
  for (const stale of folders.slice(0, Math.max(0, folders.length - MAX_CACHED_PROJECTS))) delete next.projects[stale];
  return next;
}

/** Whether a folder's commands have been read (an empty list counts: it has none). */
export function projectScanned(cache: SlashCatalogueCache | null, cwd: string): boolean {
  return cache !== null && Object.prototype.hasOwnProperty.call(cache.projects, cwd);
}

/**
 * Everything the palette offers in a pane: Codex's fixed list, or Claude's
 * built-ins, the folder's own commands and skills, the person's and plugins',
 * one per name, in palette order. Null cache: the static built-ins alone.
 */
export function catalogueFor(
  cache: SlashCatalogueCache | null,
  agent: CatalogueAgent,
  cwd: string | null
): CatalogueCommand[] {
  if (agent === 'codex') return [...CODEX_BUILTINS];
  const builtins = cache === null || cache.builtins.length === 0 ? CLAUDE_BUILTINS : cache.builtins;
  if (cache === null) return dedupeCommands(builtins);
  const project = cwd === null ? [] : (cache.projects[cwd] ?? []);
  return dedupeCommands([...builtins, ...project, ...cache.user, ...cache.plugins]);
}

// MARK: - Storage

export function serializeCatalogueCache(cache: SlashCatalogueCache): string {
  return JSON.stringify(cache);
}

const SECTIONS: readonly CommandSection[] = ['builtin', 'skills', 'commands', 'plugins'];
const SOURCES: readonly CommandSource[] = ['builtin', 'bundled', 'project', 'user', 'plugin'];

function readCommands(value: unknown): CatalogueCommand[] | null {
  if (!Array.isArray(value)) return null;
  const commands: CatalogueCommand[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const { name, description, argumentHint, section, source } = record;
    if (typeof name !== 'string' || typeof description !== 'string') return null;
    if (argumentHint !== null && typeof argumentHint !== 'string') return null;
    if (!SECTIONS.includes(section as CommandSection) || !SOURCES.includes(source as CommandSource)) return null;
    commands.push({
      name,
      description,
      argumentHint,
      section: section as CommandSection,
      source: source as CommandSource,
    });
  }
  return commands;
}

/** The stored cache, or null when the text is not one (another version, corruption). */
export function deserializeCatalogueCache(text: string | null | undefined): SlashCatalogueCache | null {
  if (text === null || text === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const builtins = readCommands(record.builtins);
  const user = readCommands(record.user);
  const plugins = readCommands(record.plugins);
  if (builtins === null || user === null || plugins === null) return null;
  if (record.binary !== null && typeof record.binary !== 'string') return null;
  if (record.hostScannedAt !== null && typeof record.hostScannedAt !== 'number') return null;
  if (typeof record.projects !== 'object' || record.projects === null || Array.isArray(record.projects)) return null;
  const projects: Record<string, CatalogueCommand[]> = {};
  for (const [cwd, list] of Object.entries(record.projects as Record<string, unknown>)) {
    const commands = readCommands(list);
    if (commands === null) return null;
    projects[cwd] = commands;
  }
  return {
    version: 1,
    binary: record.binary,
    builtins,
    user,
    plugins,
    projects,
    hostScannedAt: record.hostScannedAt,
  };
}
