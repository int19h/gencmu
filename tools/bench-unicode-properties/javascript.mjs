// Public API worker for the Unicode property performance gate.
import fs from 'node:fs';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
const root = process.argv[2];
const api = await import(pathToFileURL(`${root}/lib/js/src/node.js`));
const decode = value => Buffer.from(value, 'hex').toString('utf8');
const rows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => line.split('\t'));
const fromSources = file => api.loadPipelineSources(Object.fromEntries(rows(file).map(([k,v]) => [decode(k),decode(v)])), 'p.md');
function checkTable(name, pipeline) {
  const a=pipeline.parse('a'), b=pipeline.parse('b');
  return {name,a:a.ok,b:b.ok,tags:[...b.tree.tags].sort()};
}
const pipelines = new Map();
if (!isMainThread) {
  parentPort.postMessage(checkTable(workerData.name,fromSources(workerData.file)));
} else for await (const line of readline.createInterface({input:process.stdin})) {
  try {
    const [command, key, ...args] = line.split('\t');
    if (command === 'load') {
      const pipeline = args[0] === '-' ? api.loadPipeline('lojban/cll')
        : fromSources(args[0]);
      pipelines.set(key, pipeline);
      process.stdout.write(JSON.stringify({features:pipeline.features.map(f => [f.name,f.kind,f.default])})+'\n');
    } else if (command === 'batch') {
      const [count, manifest, output] = args;
      const cases = rows(manifest).map(([id,text,features,without]) => ({text:decode(text), options:{
        features:new Set(decode(features).split('\n').filter(Boolean)),
        withoutFeatures:new Set(decode(without).split('\n').filter(Boolean))}}));
      const pipeline = pipelines.get(key);
      let results;
      const start = performance.now();
      for (let i=0;i<Number(count);i++) results=cases.map(c=>pipeline.parse(c.text,c.options));
      const seconds=(performance.now()-start)/1000;
      const serialStart=performance.now();
      const json=results.map(result=>'{"result":'+api.toJson(result)+',"brackets":'+JSON.stringify(api.toBrackets(result))+'}');
      const serialization=(performance.now()-serialStart)/1000;
      if (output !== '-') fs.writeFileSync(output,json.join('\n')+'\n');
      process.stdout.write(JSON.stringify({seconds,serialization})+'\n');
    } else if (command === 'concurrent') {
      const tables=rows(args[0]);
      const results=await Promise.all(Array.from({length:4},()=>tables).flat().map(([name,file])=>new Promise((resolve,reject)=>{
        const worker=new Worker(new URL(import.meta.url),{argv:[root],workerData:{name,file}});
        worker.once('message',resolve);worker.once('error',reject);
        worker.once('exit',code=>{if(code)reject(new Error(`A table worker failed: ${code}`));});
      })));
      process.stdout.write(JSON.stringify(results)+'\n');
    } else throw new Error(`Unknown command: ${command}`);
  } catch(error) {
    process.stdout.write(JSON.stringify({error:String(error.stack || error)})+'\n');
    process.exitCode=1;
    break;
  }
}
