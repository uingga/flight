const fs=require('node:fs');
const yaml=require('js-yaml');
const ts=require('typescript');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const file of ['.github/workflows/daily-crawl.yml','.github/workflows/crawl-watchdog.yml']) {
  const workflow=yaml.load(fs.readFileSync(file,'utf8'));
  for(const job of Object.values(workflow.jobs)) for(const step of job.steps||[]) {
    if(step.uses?.startsWith('actions/github-script') && step.with?.script) {
      new AsyncFunction('github','context','core','require',step.with.script.replace(/\$\{\{[\s\S]*?\}\}/g,'fixture'));
    }
  }
  console.log(file+': YAML and embedded JavaScript syntax OK');
}
const file='src/app/api/internal/crawl-watchdog/route.ts';
const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
if(result.diagnostics?.length)throw Error('TypeScript syntax diagnostics');
console.log(file+': TypeScript syntax OK (not a full application build)');
