// Writes public/THIRD_PARTY_LICENSES.txt: license texts for everything bundled
// into the extension (fonts are OFL-1.1, which requires shipping the license).
// Usage: node scripts/third-party-licenses.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BUNDLED = [
  '@fontsource-variable/bricolage-grotesque',
  '@fontsource/ibm-plex-sans',
  '@fontsource/ibm-plex-mono',
  'react',
  'react-dom',
  ['react-dom', 'scheduler'], // React DOM's own dependency.
];

const sections = BUNDLED.map((entry) => {
  const [from, name] = Array.isArray(entry) ? entry : ['.', entry];
  const base = from === '.' ? import.meta.url : createRequire(import.meta.url).resolve(`${from}/package.json`);
  const pkgPath = createRequire(base).resolve(`${name}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const license = readFileSync(join(dirname(pkgPath), 'LICENSE'), 'utf8').trim();
  return `${pkg.name} ${pkg.version} (${pkg.license})\n${'-'.repeat(60)}\n${license}`;
});

writeFileSync(
  'public/THIRD_PARTY_LICENSES.txt',
  `Third-party software bundled in this extension.\n\n${sections.join('\n\n\n')}\n`,
);
console.log(`wrote public/THIRD_PARTY_LICENSES.txt (${sections.length} packages)`);
