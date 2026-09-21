import fs from 'fs';
import path from 'path';

export const INPUT_DIR_LEAVES = {
  INPUT_DATA_DIR: 'data',
  INPUT_PROMPTS_DIR: 'prompts',
  INPUT_SCHEMAS_DIR: 'schemas',
  INPUT_EVALUATORS_DIR: 'evaluators',
  INPUT_ANNOTATIONS_DIR: 'annotations',
  INPUT_LABELS_DIR: 'labels'
};

function isSuiteDir(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function listSuiteNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

function lookupSuite(name, inputsRoot, examplesRoot) {
  const local = path.resolve(inputsRoot, name);
  if (isSuiteDir(local)) {
    return local;
  }
  const bundled = path.resolve(examplesRoot, name);
  if (isSuiteDir(bundled)) {
    return bundled;
  }

  const examples = listSuiteNames(examplesRoot);
  const inputs = listSuiteNames(inputsRoot);
  const hint = [
    inputs.length ? `inputs: ${inputs.join(', ')}` : '',
    examples.length ? `examples: ${examples.join(', ')}` : ''
  ].filter(Boolean).join('; ');
  throw new Error(
    `Suite "${name}" not found under inputs/ or examples/. Set INPUT_EXPERIMENT to a suite folder name.` +
    (hint ? ` Available (${hint}).` : '')
  );
}

function suiteRootFromInputDir(raw, leaf, projectRoot) {
  const resolved = path.resolve(projectRoot, String(raw).trim());
  return path.basename(resolved) === leaf ? path.dirname(resolved) : resolved;
}

export function resolveInputDir(env, envKey, projectRoot, fallback) {
  const raw = env[envKey];
  if (!raw || !String(raw).trim()) {
    return fallback;
  }
  return path.resolve(projectRoot, String(raw).trim());
}

export function inferSuiteRootFromInputDirs(env, projectRoot) {
  const roots = [];
  for (const [key, leaf] of Object.entries(INPUT_DIR_LEAVES)) {
    const raw = env[key];
    if (!raw || !String(raw).trim()) {
      continue;
    }
    roots.push(suiteRootFromInputDir(raw, leaf, projectRoot));
  }
  if (roots.length === 0) {
    return null;
  }
  const first = roots[0];
  if (roots.some(root => root !== first)) {
    throw new Error('INPUT_*_DIR point at different suite folders. Set INPUT_EXPERIMENT to a suite folder name.');
  }
  return first;
}

export function resolveExperiment({
  env,
  projectRoot,
  examplesRoot,
  inputsRoot,
  defaultExperiment
}) {
  const explicit = String(env.INPUT_EXPERIMENT || env.EXPERIMENT || '').trim();
  if (explicit) {
    return { name: path.basename(explicit), root: lookupSuite(explicit, inputsRoot, examplesRoot) };
  }

  const inferredRoot = inferSuiteRootFromInputDirs(env, projectRoot);
  if (inferredRoot && isSuiteDir(inferredRoot)) {
    return { name: path.basename(inferredRoot), root: inferredRoot };
  }

  const name = defaultExperiment;
  return { name, root: lookupSuite(name, inputsRoot, examplesRoot) };
}
