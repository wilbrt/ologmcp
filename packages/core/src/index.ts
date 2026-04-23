export { OlogStore } from './db.js';
export type {
  OlogElem,
  OlogArr,
  OlogAttr,
  IngestResult,
  QueryResult,
  InspectResult,
  DumpResult,
  RawElement,
  RawArrow,
} from './ontology.js';
export {
  discoverTsFiles,
  ingestProject,
  reindexProject,
} from './ingest/project.js';
