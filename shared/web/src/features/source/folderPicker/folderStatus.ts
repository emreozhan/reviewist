import type { FsEntry, FsListing } from '../../../../../src/shared/types';

/** Seçilecek yolun git durumu (alt çubuk). */
export type FolderStatus =
  | { kind: 'repo'; path: string }
  | { kind: 'inside'; path: string; repoRoot: string }
  | { kind: 'plain'; path: string };

/** Hedef: listede seçili klasör, yoksa o an gezilen klasör. */
export function folderStatus(listing: FsListing, selected?: FsEntry): FolderStatus {
  if (selected) {
    if (selected.isGitRepo) return { kind: 'repo', path: selected.path };
    if (listing.isGitRepo) return { kind: 'inside', path: selected.path, repoRoot: listing.path };
    if (listing.repoRoot) return { kind: 'inside', path: selected.path, repoRoot: listing.repoRoot };
    return { kind: 'plain', path: selected.path };
  }
  if (listing.isGitRepo) return { kind: 'repo', path: listing.path };
  if (listing.repoRoot) return { kind: 'inside', path: listing.path, repoRoot: listing.repoRoot };
  return { kind: 'plain', path: listing.path };
}
