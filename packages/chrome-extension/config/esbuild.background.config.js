/**
 * @file esbuild configuration for the background service worker
 * Transpiles the TS/JS entry point into MV3-ready JS while keeping file layout.
 */

/* global process, console */

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');
const outDir = process.env.EXTENSION_OUT_DIR || 'dist/extension';

// Resolve an entry point, preferring .ts when present (fallback to .js)
function resolveEntry(relativePathWithoutExt) {
  for (const extension of ['.ts', '.tsx', '.js']) {
    const candidate = path.join(
      projectRoot,
      `${relativePathWithoutExt}${extension}`,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing entry point: ${relativePathWithoutExt}`);
}

const entryPoints = [
  resolveEntry('src/background/service-worker'),
  resolveEntry('src/sidepanel'),
];

async function build() {
  const ctx = await esbuild.context({
    entryPoints,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome115'],
    minify: isProduction,
    sourcemap: !isProduction,
    metafile: !isWatch,
    conditions: ['style'],
    define: {
      'import.meta.env.DEV': 'false',
    },
    alias: {
      '@': path.resolve(projectRoot, '../web-shell/client'),
      '@qwen-code/acp-bridge/channelControlTimeouts': path.resolve(
        projectRoot,
        '../acp-bridge/src/channel-control-timeouts.ts',
      ),
      '@qwen-code/acp-bridge/daemonEventTypes': path.resolve(
        projectRoot,
        '../acp-bridge/src/daemonEventTypes.ts',
      ),
      '@qwen-code/acp-bridge/mcpTimeouts': path.resolve(
        projectRoot,
        '../acp-bridge/src/mcpTimeouts.ts',
      ),
      '@qwen-code/sdk/daemon': path.resolve(
        projectRoot,
        '../sdk-typescript/src/daemon/index.ts',
      ),
      '@qwen-code/web-shell': path.resolve(
        projectRoot,
        '../web-shell/client/index.tsx',
      ),
      '@qwen-code/webui/daemon-react-sdk': path.resolve(
        projectRoot,
        '../webui/src/daemon-react-sdk.ts',
      ),
    },
    loader: {
      '.gif': 'file',
      '.jpeg': 'file',
      '.jpg': 'file',
      '.png': 'file',
      '.svg': 'file',
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    outdir: path.join(projectRoot, outDir),
    outbase: path.join(projectRoot, 'src'),
    logLevel: 'info',
  });

  if (isWatch) {
    console.log('Watching extension scripts...');
    await ctx.watch();
  } else {
    const result = await ctx.rebuild();
    if (result.metafile) {
      const metafilePath = path.join(projectRoot, 'dist/esbuild.json');
      fs.mkdirSync(path.dirname(metafilePath), { recursive: true });
      fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));
    }
    await ctx.dispose();
    console.log('Extension script build complete!');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
