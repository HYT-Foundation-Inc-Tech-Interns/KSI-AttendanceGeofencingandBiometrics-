#!/usr/bin/env node
/*
 * Re-applies the Node 24 fix to @expo/cli after every `npm install`.
 *
 * Why this exists
 * ---------------
 * Expo SDK 50 targets Node 18. On Node 24, `module.builtinModules` lists some
 * stdlib modules with their `node:` prefix (`node:sea`, `node:sqlite`,
 * `node:test`, ...). @expo/cli used those strings verbatim as directory names
 * under `.expo/metro/externals/`, and a colon is illegal in a Windows path, so
 * `expo start` died with ENOENT before bundling a single file.
 *
 * @expo/cli's own `isNodeExternal()` already strips the prefix before checking
 * membership; only the *folder naming* was left un-stripped. This patch makes
 * the two agree. No two Node builtins collide once the prefix is removed, so
 * the strip is safe.
 *
 * Wired as `postinstall` in package.json, so a fresh `npm install` re-applies
 * it automatically. node_modules is not source; editing it by hand would be
 * undone by the next install.
 *
 * If this script fails, do NOT ignore it: read the message. It almost always
 * means @expo/cli was upgraded and the anchors below moved, in which case the
 * fix needs re-deriving against the new version.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '__expoShimDirName';

// Anchor text below is from @expo/cli 50.x. Both substitutions are required;
// patching only one leaves the dev server failing on a different line.
const EDITS = [
  {
    find:
      'function getNodeExternalModuleId(fromModule, moduleId) {\n' +
      '    return _path.default.relative(_path.default.dirname(fromModule), _path.default.join(METRO_EXTERNALS_FOLDER, moduleId, "index.js"));\n' +
      '}',
    replace:
      'function __expoShimDirName(moduleId) {\n' +
      '    return moduleId.replace(/^node:/, "");\n' +
      '}\n' +
      'function getNodeExternalModuleId(fromModule, moduleId) {\n' +
      '    return _path.default.relative(_path.default.dirname(fromModule), _path.default.join(METRO_EXTERNALS_FOLDER, __expoShimDirName(moduleId), "index.js"));\n' +
      '}',
  },
  {
    find: 'const shimDir = _path.default.join(projectRoot, METRO_EXTERNALS_FOLDER, moduleId);',
    replace:
      'const shimDir = _path.default.join(projectRoot, METRO_EXTERNALS_FOLDER, __expoShimDirName(moduleId));',
  },
];

function fail(msg) {
  console.error('\n[patch-expo-cli] ' + msg + '\n');
  process.exit(1);
}

function targetFile() {
  try {
    return path.join(
      path.dirname(require.resolve('@expo/cli/package.json')),
      'build/src/start/server/metro/externals.js'
    );
  } catch {
    return null;
  }
}

const file = targetFile();

// @expo/cli legitimately absent (e.g. a production-only install) is not an
// error — there is simply nothing to patch.
if (!file) {
  console.log('[patch-expo-cli] @expo/cli not installed; nothing to patch.');
  process.exit(0);
}

if (!fs.existsSync(file)) {
  fail(
    '@expo/cli is installed but the patch target is missing:\n  ' +
      file +
      '\nThe package layout changed. The Node 24 shim fix needs re-deriving.'
  );
}

const original = fs.readFileSync(file, 'utf8');

if (original.includes(MARKER)) {
  console.log('[patch-expo-cli] already patched; nothing to do.');
  process.exit(0);
}

let patched = original;
for (const { find, replace } of EDITS) {
  if (!patched.includes(find)) {
    fail(
      'anchor not found in ' +
        file +
        '\n\nLooked for:\n---\n' +
        find +
        '\n---\n\n@expo/cli has probably been upgraded and this patch is stale.\n' +
        'Do not skip this: without it `expo start` fails on Node 24 with\n' +
        'ENOENT mkdir "...\\node:sea". Re-derive the fix against the new version.'
    );
  }
  patched = patched.replace(find, replace);
}

if (!patched.includes(MARKER)) {
  fail('internal error: substitution produced no marker. Refusing to write.');
}

fs.writeFileSync(file, patched);
console.log('[patch-expo-cli] applied Node 24 shim-dir fix to @expo/cli.');
