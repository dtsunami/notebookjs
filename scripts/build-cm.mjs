/**
 * Bundle the iframe's CodeMirror into public/cm/editor.js.
 *
 * It must be a built file rather than a module import: the runtime is injected
 * into a sandboxed iframe, and CodeMirror has to construct its DOM with that
 * iframe's own document. See src/cm/editor.js.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('public/cm', { recursive: true });

await build({
  entryPoints: ['src/cm/editor.js'],
  bundle: true,
  format: 'iife',
  globalName: 'NBEditorBundle',
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  outfile: 'public/cm/editor.js',
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('built public/cm/editor.js');