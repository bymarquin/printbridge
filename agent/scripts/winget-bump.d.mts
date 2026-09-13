export const PACKAGE_ID: string;
export const MANIFEST_VERSION: string;
export function installerUrl(owner: string, repo: string, version: string): string;
export function sha256File(filePath: string): string;
export function buildManifests(args: {
  version: string;
  url: string;
  sha: string;
  publisher?: string;
}): Record<string, string>;
