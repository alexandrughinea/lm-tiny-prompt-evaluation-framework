import { CONFIGURATION } from '../src/config.js';
import {
  STATED_CONFIDENCE,
  fieldNamesFromSuite,
  isPlainObject,
  readGoldFile
} from '../utils/label-normalize.js';

export { STATED_CONFIDENCE, isPlainObject };

export function loadFieldNames() {
  const directories = CONFIGURATION.directories;
  return fieldNamesFromSuite({
    root: directories.root,
    schemasDir: directories.schemas,
    labelsDir: directories.labels
  });
}

export function loadGoldLabel(inputDataFile) {
  return readGoldFile(CONFIGURATION.directories.labels, inputDataFile, loadFieldNames());
}
