// Builds a single self-contained HTML file (game code + Three.js + CSS inlined), suitable for
// sharing as one file or hosting anywhere (no server, no external requests).
// Usage: npm run build:single  ->  dist/storm-island.html
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist', 'storm-island.html');

const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  alias: { three: resolve(root, 'vendor/three.module.js') },
  write: false,
  legalComments: 'none',
  define: { 'import.meta.dirname': '""' },
  logLevel: 'warning',
});
let js = result.outputFiles[0].text;
// never let the bundle close the inline <script> tag early
js = js.replace(/<\/script/gi, '<\\/script');

const css = await readFile(resolve(root, 'style.css'), 'utf8');
let html = await readFile(resolve(root, 'index.html'), 'utf8');
html = html
  .replace(/\s*<link rel="stylesheet" href="style.css">/, `\n  <style>\n${css}\n  </style>`)
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script>\n${js}\n</script>`);

html = html.replace('<head>', `<head>\n  <!-- Storm Island — single-file build. Includes three.js (MIT License, Copyright © 2010-2024 three.js authors). -->`);

await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(out, html);
console.log(`Built ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);

// Artifact variant (claude.ai artifacts wrap the file in their own <!doctype>/<head>/<body> skeleton):
// title + style + body content + script only. The game commits to one look, so it pins its own
// colors and color-scheme instead of following the viewer's light/dark theme.
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();
const artifact = `<title>Storm Island</title>
<!-- Storm Island — single-file build. Includes three.js (MIT License, Copyright © 2010-2024 three.js authors). -->
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
`;
const outA = resolve(root, 'dist', 'storm-island-artifact.html');
await writeFile(outA, artifact);
console.log(`Built ${outA} (${(Buffer.byteLength(artifact) / 1024 / 1024).toFixed(2)} MB)`);
