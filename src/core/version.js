/**
 * Uygulama versiyonu — tek kaynak: package.json "version".
 * Gelistirmede arttirma: CHANGELOG.md kurallarina uy, package.json bump et.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

export const APP_VERSION = pkg.version;
export const APP_NAME = pkg.name;

/** Dashboard / API icin kisa etiket */
export function versionLabel() {
  return `v${APP_VERSION}`;
}
