import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngineCase} from './shared.js';
import {hooks} from '../src/testing.js';
import {GencmuError} from '../src/errors.js';

// Engine §12.1: grammar failures omit evaluated own diagnostics under erasure.
test('message failures drop erased diagnostics in unique and tied readings',()=>{
  for(const [tied,failAt]of [[false,1],[true,1],[true,2]]){
    const body='first gone fail',seen=[];
    const source='%stage before\n%ambiguity-resolution greedy\n%rule text $a:A $b:older $c:C\n%emits $a, $b, $c\n%rule older B\n%error "input fault"\n%stage last\n%ambiguity-resolution greedy\n%rule text '+body+(tied?' | '+body:'')+'\n%rule first A\n%warning "kept"\n%rule gone bad notice\n%erased\n%rule bad B\n%error "erased error"\n%rule notice ε\n%warning "erased warning"\n%rule fail C\n%warning "stop"';
    let calls=0;
    hooks.diagnosticMessage=node=>{
      seen.push(node.production.lhs);
      if(node.production.lhs==='fail'&&++calls===failAt)throw new GencmuError('grammar','message guard');
    };
    try{
      const {json}=runEngineCase({documents:{'p.md':'```jbogenbau\n'+source+'\n```\n'},pipelineDocument:'p.md',tokens:['A','B','C'].map(tag=>({text:tag.toLowerCase(),tags:[tag]})),options:{features:['first','notice','fail']}});
      assert.equal(json.error.kind,'grammar');assert.equal(json.stages.at(-1).verdict,tied?'tie':'unique');
      assert.equal(json.tree,null);assert.equal(json.stages.at(-1).output,undefined);
      assert.deepEqual(json.error.errors.map(d=>[d.stage,d.code]),[['before','older']]);
      assert.deepEqual(json.warnings.map(d=>d.code),failAt===2?['first','fail','first']:['first']);
      assert.deepEqual(json.error.warnings,json.warnings);
      assert.equal(seen.filter(name=>name==='bad').length,failAt);
      assert.equal(seen.filter(name=>name==='notice').length,failAt);
      assert.equal(json.stages[0].output.length,3);
      assert.equal(json.stages[0].output[1].errors[0].code,'older');
    }finally{hooks.diagnosticMessage=null;}
  }
});
