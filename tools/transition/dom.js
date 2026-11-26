// The transition compiler reads a format 50 document with the same notation
// tree conversion as the native reader, so that both report the same records
// and the same diagnostics in the same order (engine §9.3).
export { DomBuilder, inspectConverted50 } from "../../lib/js/src/format50/walk.js";
