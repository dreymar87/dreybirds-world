// Runs every suite in sequence and reports a single verdict.
// CI runs them in parallel as a matrix; this is for a local `npm test`.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const suites = readdirSync(HERE)
  .filter(f => f.endsWith('.mjs') && !['run-all.mjs', 'make-icons.mjs'].includes(f))
  .sort();

const run = file => new Promise(done => {
  const started = Date.now();
  const child = spawn(process.execPath, [HERE + file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const tally = (out.match(/(\d+)\/(\d+) checks passed/) || [])[0] || 'no result';
    console.log((code === 0 ? 'PASS' : 'FAIL') + '  ' + file.padEnd(20) + tally.padEnd(22) + secs + 's');
    if (code !== 0) out.split('\n').filter(l => l.startsWith('FAIL')).forEach(l => console.log('      ' + l));
    done(code === 0);
  });
});

console.log('Running ' + suites.length + ' suites\n');
const results = [];
for (const s of suites) results.push(await run(s));
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' suites passed');
process.exit(failed ? 1 : 0);
