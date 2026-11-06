import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadEngineCase,parseEngineCase} from './shared.js';

// Engine §12.1: both collection paths preserve preorder for each kind.
test('attachment parent and child errors retain preorder in unique and tied readings',()=>{
  for(const owner of ['parent','child']){
    const fixture=JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-fix2-attachment-'+owner+'-preorder.json',import.meta.url),'utf8'));
    fixture.documents['p.md']=fixture.documents['p.md'].replaceAll('%warning','%error');
    const {pipeline,loadError}=loadEngineCase(fixture);assert.ifError(loadError);
    const unique=parseEngineCase(pipeline,fixture,{options:{features:[]}}).json;
    const tied=parseEngineCase(pipeline,fixture,{options:{features:['tied']}}).json;
    const code=owner==='parent'?'pair':'fresh';
    assert.equal(unique.error.kind,'reported');assert.equal(unique.stages.at(-1).verdict,'unique');
    assert.equal(tied.error.kind,'ambiguous');assert.equal(tied.error.reason,'tie');assert.equal(tied.stages.at(-1).verdict,'tie');
    assert.deepEqual(unique.error.errors.map(d=>d.code),[code,'old']);
    assert.deepEqual(tied.error.errors,unique.error.errors);
    assert.deepEqual(unique.stages.at(-1).output[0].errors.map(d=>d.code),['old',code]);
    assert.equal(tied.stages.at(-1).output,undefined);
  }
});
