// Public API worker for the Unicode property performance gate.
import fs from 'node:fs';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
const root = process.argv[2];
const api = await import(pathToFileURL(`${root}/lib/js/src/node.js`));
const decode = value => Buffer.from(value, 'hex').toString('utf8');
const rows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => line.split('\t'));
const dialects = new Map();
for await (const line of readline.createInterface({input:process.stdin})) {
  try {
    const [command, key, ...args] = line.split('\t');
    if (command === 'load') {
      const dialect = args[0] === '-' ? api.loadDialect('cll-ebnf')
        : api.loadDialectSources(Object.fromEntries(rows(args[0]).map(([k,v]) => [decode(k),decode(v)])), 'p.md');
      dialects.set(key, dialect);
      process.stdout.write(JSON.stringify({features:dialect.features.map(f => [f.name,f.kind,f.default])})+'\n');
    } else if (command === 'batch') {
      const [count, manifest, output] = args;
      const cases = rows(manifest).map(([id,text,features,without]) => ({text:decode(text), options:{
        features:new Set(decode(features).split('\n').filter(Boolean)),
        withoutFeatures:new Set(decode(without).split('\n').filter(Boolean))}}));
      const dialect = dialects.get(key);
      let results;
      const start = performance.now();
      for (let i=0;i<Number(count);i++) results=cases.map(c=>dialect.parse(c.text,c.options));
      const seconds=(performance.now()-start)/1000;
      const serialStart=performance.now();
      const json=results.map(result=>'{"result":'+api.toJson(result)+',"brackets":'+JSON.stringify(api.toBrackets(result))+'}');
      const serialization=(performance.now()-serialStart)/1000;
      if (output !== '-') fs.writeFileSync(output,json.join('\n')+'\n');
      process.stdout.write(JSON.stringify({seconds,serialization})+'\n');
    } else throw new Error(`Unknown command: ${command}`);
  } catch(error) {
    process.stdout.write(JSON.stringify({error:String(error.stack || error)})+'\n');
    process.exitCode=1;
    break;
  }
}
