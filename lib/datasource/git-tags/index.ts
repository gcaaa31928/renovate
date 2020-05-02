import * as semver from '../../versioning/semver';
import { GetReleasesConfig, ReleaseResult } from '../common';
import * as gitRefs from '../git-refs';

export const id = 'git-tags';

export async function getReleases({
  lookupName,
}: GetReleasesConfig): Promise<ReleaseResult | null> {
  const rawRefs: gitRefs.RawRefs[] = await gitRefs.getRawRefs({ lookupName });

  if (rawRefs === null) {
    return null;
  }
  const releases = rawRefs
    .filter((ref) => ref.type === 'tags')
    .filter((ref) => semver.isVersion(ref.value))
    .map((ref) => ({
      version: ref.value,
      gitRef: ref.value,
      newDigest: ref.hash,
    }));

  const sourceUrl = lookupName.replace(/\.git$/, '').replace(/\/$/, '');

  const result: ReleaseResult = {
    sourceUrl,
    releases,
  };

  return result;
}
