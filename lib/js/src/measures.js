// Additive diagnostic charges and profile order (engine §1, §6).
import {Sources} from './tokens.js';

/** @typedef {number|bigint} Count */
/** @typedef {[Count,Count,Count]} Measure */
/** @type {Measure} */
export const ZERO_MEASURE=Object.freeze(/** @type {any} */([0,0,0]));

/** @param {Count} left @param {Count} right @returns {Count} */
export function addCount(left,right){
  if(typeof left==='number' && typeof right==='number'){
    const sum=left+right;
    if(sum<=Number.MAX_SAFE_INTEGER || sum===Infinity)return sum;
  }
  if(left===Infinity || right===Infinity)return Infinity;
  return BigInt(left)+BigInt(right);
}

/** @param {Measure} left @param {Measure} right @returns {Measure} */
export function sumMeasure(left,right){
  if(left===ZERO_MEASURE)return right;
  if(right===ZERO_MEASURE)return left;
  return [addCount(left[0],right[0]),addCount(left[1],right[1]),addCount(left[2],right[2])];
}

/** Negative means that the left measure wins. @param {ArrayLike<any>} left @param {ArrayLike<any>} right */
export function compareMeasure(left,right){
  for(let index=0;index<3;index++)if(left[index]<right[index] || left[index]>right[index]){
    const order=left[index]<right[index]?-1:1;
    return index===2?-order:order;
  }
  return 0;
}

// Public diagnostic objects carry no charge or identity fields. Copies
// retain this private record rather than deriving a charge from new spans.
/** @type {WeakMap<object,{measure:Measure,identity:object}>} */
const records=new WeakMap();
/** @param {object} diagnostic @param {Measure} measure @param {object} [identity] */
export function recordDiagnostic(diagnostic,measure,identity={}){
  records.set(diagnostic,{measure:/** @type {Measure} */(Object.freeze([...measure])),identity});
  return diagnostic;
}
/** @param {object} diagnostic */
export function diagnosticRecord(diagnostic){
  const record=records.get(diagnostic);
  if(!record)throw new Error('An engine diagnostic requires a fixed charge and identity.');
  return record;
}
/** @param {object} original @param {object} copy */
export function copyDiagnosticRecord(original,copy){
  const record=records.get(original);
  if(record)records.set(copy,record);
  return copy;
}

export class Measures {
  /** @param {import('./tokens.js').Token[]} tokens @param {Sources} [sources] */
  constructor(tokens,sources=new Sources(tokens)){
    this.sources=sources;
    this.nonempty=[0];
    /** @type {Measure[]} */
    this.carried=[];
    for(const token of tokens){
      this.nonempty.push(this.nonempty[this.nonempty.length-1]+(token.source[0]<token.source[1]?1:0));
      let measure=ZERO_MEASURE;
      for(const diagnostic of token.errors)measure=sumMeasure(measure,diagnosticRecord(diagnostic).measure);
      this.carried.push(measure);
    }
  }
  /** @param {number} start @param {number} end @returns {Measure} */
  own(start,end){
    if(this.nonempty[end]===this.nonempty[start])return [0,1,1];
    const [low,high]=this.sources.of(start,end);
    return [high-low,0,1];
  }
}
