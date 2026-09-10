import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:31862';
const flight=(id,city,airport,date,source='modetour',price=300000)=>({id,source,airline:'제주항공',departure:{city,airport,date,time:'10:00'},arrival:{city:'오사카',airport:'KIX',date,time:'15:00'},price,currency:'KRW',availableSeats:4,region:'일본',link:'https://example.invalid/booking'});
const fixtures=[flight('incheon','인천','ICN','2030-10-03'),flight('busan','부산','PUS','2030-10-04'),flight('late','인천','ICN','2030-10-20'),flight('jeju-late','제주','CJU','2030-10-20'),flight('other-source','인천','ICN','2030-10-03','ybtour'),flight('expensive','인천','ICN','2030-10-03','modetour',450000)];
const params=new URLSearchParams({dep:'CJU',q:'오사카',from:'2030-10-01',to:'2030-10-10',source:'modetour',max:'350000'});
const browser=await chromium.launch();
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2','dismissed'));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith('/api/'))return route.fulfill({json:['/api/flights','/api/preview-flights'].includes(url.pathname)?{success:true,flights:fixtures,lastUpdated:new Date().toISOString()}:{success:true}});return route.continue();});
  await page.goto(origin+'/preview/mobile-redesign?'+params);
  const action=page.getByRole('button',{name:'출발지 · 제주 조건 해제 다른 출발지 항공권 2개 보기',exact:true});await action.waitFor();
  assert.equal(await page.locator('article[data-flight-id]').count(),0);
  assert.equal(await page.getByText('선택한 조건에 맞는 항공권이 없어요.',{exact:true}).count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'output/empty-filter-'+width+'.png',fullPage:true});
  await action.click();await page.waitForFunction(()=>document.querySelectorAll('article[data-flight-id]').length===2);
  assert.deepEqual((await page.locator('article[data-flight-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-flight-id')))).sort(),['busan','incheon']);
  await page.goto(origin+'/preview/mobile-redesign?'+params);
  await page.getByRole('button',{name:/출발일 · .* 조건 해제 해제하면 항공권 1개 보기/}).click();
  await page.waitForFunction(()=>document.querySelectorAll('article[data-flight-id]').length===1);
  assert.equal(await page.locator('article[data-flight-id]').getAttribute('data-flight-id'),'jeju-late');
  const multi=new URLSearchParams(params);multi.set('max','100000');await page.goto(origin+'/preview/mobile-redesign?'+multi);
  await page.getByText('조건 하나만 해제해도 결과가 없어요. 두 개 이상 바꾸거나 초기화해 보세요.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/해제.*개 보기/}).count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: explicit filter removal, accurate revealed count, retained dates/departure/source/price/query, multiple blockers and 320/390/1440px');
}finally{await browser.close();}
