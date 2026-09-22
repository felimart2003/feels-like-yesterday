const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  const elements = new Map();
  const element = () => ({value:'', textContent:'', innerHTML:'', hidden:true, dataset:{}, style:{}, classList:{add(){},remove(){},toggle(){}}, addEventListener(){}, setAttribute(){}, appendChild(){}});
  const context = {console, Date, AbortSignal, setTimeout, clearTimeout, window:{}, navigator:{}, localStorage:{getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}}, document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return [];},createElement:element}, fetch:async()=>{throw Error('Network unavailable');}};
  vm.createContext(context);
  const source = fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8').replace(/boot\(cityInput.value\);\s*$/, '');
  vm.runInContext(source,context);
  return {context,elements};
}
test('layer boundaries and dial clamp',()=>{
  const {context:c}=setup();
  assert.equal(c.getLayerFromFeelsLike(9.9).layer,'coat');
  assert.equal(c.getLayerFromFeelsLike(10).layer,'sweater');
  assert.equal(c.getLayerFromFeelsLike(20).layer,'tshirt');
  assert.equal(c.getDialAngle(-100),-90);
  assert.equal(c.getDialAngle(100),90);
});
test('missing measurements never become zero weather',()=>{
  const {context:c}=setup();
  assert.equal(c.avg(null,undefined,NaN),null);
  assert.throws(()=>c.getDailyStatsForDate({time:['2026-09-21T00:00'],temperature_2m:[null]},'2026-09-21'),/missing measurements/);
});
test('coordinate boundaries reject invalid locations', async()=>{
  const {context:c}=setup();
  await assert.rejects(c.resolveLocation('91,0'),/out of range/);
  await assert.rejects(c.resolveLocation('0,-181'),/out of range/);
  assert.equal((await c.resolveLocation('43.65,-79.38')).latitude,43.65);
});
test('network failure is visible and does not manufacture a forecast',async()=>{
  const {context:c,elements}=setup();
  await c.boot('Toronto');
  assert.match(elements.get('#status').textContent,/Network unavailable/);
  assert.equal(c.window.__layerData,undefined);
});
test('provider timezone dates and apparent temperatures survive rendering',async()=>{
  const {context:c,elements}=setup();
  const time=['2026-09-20T12:00','2026-09-21T12:00'];
  c.fetch=async()=>({ok:true,json:async()=>({current:{time:'2026-09-21T03:00'},hourly:{time,temperature_2m:[10,20],apparent_temperature:[8,17],relative_humidity_2m:[70,60],wind_speed_10m:[15,10],precipitation:[1,0],weather_code:[3,1],uv_index:[2,4]}})});
  const response=await c.fetchOpenMeteoFallback('43,-79');
  assert.equal(response.dates.yesterday,'2026-09-20');
  c.render(response.sources,response.dates);
  assert.equal(elements.get('#today-feels').textContent,'17°C');
  assert.equal(elements.get('#temp-change').textContent,'+10°C');
});
test('restricted localStorage is nonfatal',()=>{
  const {context:c}=setup();
  assert.equal(c.storageGet('x'),null);
  assert.equal(c.storageSet('x','y'),false);
});
