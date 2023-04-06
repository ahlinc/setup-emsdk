import * as core from '@actions/core'

/**
 * Indicates whether the POST action is running
 */
export const IsPost = !!core.getState('isPost')

// Publish a variable so that when the POST action runs, it can determine it should run the cleanup logic.
// This is necessary since we don't have a separate entry point.
if (!IsPost) {
  core.saveState('isPost', 'true')
}

export function foundInCache() {
  return core.getState('foundInCache') === 'true';
}

export function setFoundInCache(foundInCache: boolean): boolean {
  core.saveState('foundInCache', foundInCache ? 'true' : 'false');
  return foundInCache;
}

export function emsdkFolder() {
  return core.getState('emsdkFolder');
}

export function setEmsdkFolder(emsdkFolder: string): string {
  core.saveState('emsdkFolder', emsdkFolder);
  return emsdkFolder;
}

