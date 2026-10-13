/**
 * A clip's type is the folder it sits in.
 *
 *   video/Full match/Veo - Match - 1st XI football-clip 1.mp4   -> "Full match"
 *   video/30s clips/0001.mp4                                      -> "30s clips"
 *   video/gt/009067472_8f16bc….mp4                               -> "gt"
 *   video/0001.mp4                                                -> null (unsorted)
 *
 * Only the first folder under video/ counts, so a type can be organised into
 * subfolders of its own without becoming a new type. Nothing is stored: the
 * folders are the record, so moving a file is how its type is changed, and a
 * new folder is a new type with no code to touch.
 */
export function clipCategory(rel) {
  const parts = String(rel ?? '').split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}
