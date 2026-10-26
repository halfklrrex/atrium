/** Where the AGPL section 13 source offer points. The repository is private for now (docs/PROVENANCE.md). */
export const SOURCE_REPO_URL = 'https://github.com/halfklrrex/atrium';

/** Git short SHA this build was made from, or `dev` when built without git. */
export const APP_VERSION: string = __ATRIUM_VERSION__;

export interface AboutLinks {
  source: string;
  licence: string;
  notices: string;
}

/** Links that open the source tree and licence files at the commit that was built. */
export function aboutLinks(version: string = APP_VERSION): AboutLinks {
  const ref = /^[0-9a-f]{7,40}$/.test(version) ? version : 'main';
  return {
    source: `${SOURCE_REPO_URL}/tree/${ref}`,
    licence: `${SOURCE_REPO_URL}/blob/${ref}/LICENSE`,
    notices: `${SOURCE_REPO_URL}/blob/${ref}/THIRD_PARTY_NOTICES.md`,
  };
}
