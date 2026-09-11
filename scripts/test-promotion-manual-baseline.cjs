const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file) {
  const out = {};
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop:true } }).outputText;
  vm.runInNewContext(code, { exports:out, require: id => {
    if (id.endsWith('.module.css')) return {};
    if (id === '@/lib/promotion-daily') return load('src/lib/promotion-daily.ts');
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    throw new Error('Unexpected test import: '+id);
  }});
  return out;
}
const { PromotionDailyView } = load('src/components/AdminPromotionDaily.tsx');
// Explicit synthetic rendering fixture: an old manual recommendation, not a fresh API observation.
const at = '2026-09-08T19:40:00+09:00';
const payload = { source:'te31',outcome:'partial',reason:'manual_observations_preserved',observedAt:at,lastSuccessAt:null,posts:[{id:'fixture',platform:'te31',title:'수동 기록 보존 검증',url:'',metrics:{recommendations:{value:1,day:'2026-09-08',observedAt:at}}}] };
const html = renderToStaticMarkup(React.createElement(PromotionDailyView,{data:{latest:[{source:'te31',payload}],runs:[],sources:[],dispatches:[]}}));
assert.ok(html.includes('기존 수동 확인값 보존'), 'manual baseline must be identified separately from a fresh collection');
assert.ok(html.includes('과거 확인값과 확인 시각을 유지'), 'unsupported fresh recommendations must not contradict retained old observations');
assert.ok(html.includes('2026-09-08') && html.includes('<strong>1</strong>'), 'original old recommendation and date must remain visible');
console.log('PASS: preserved manual baseline provenance, recommendation value and original observation date');
