import { sfGet } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';
const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1);

const todas = await sfGet(`${V}/ui-api/object-info/Case/picklist-values/${rt}`);
const entradas = Object.entries(todas.picklistFieldValues ?? {});

// acha uma picklist DEPENDENTE (tem controllerValues preenchido)
const dependentes = entradas.filter(([, v]) => Object.keys(v.controllerValues ?? {}).length > 0);
console.log(`picklists no Record Type: ${entradas.length} · dependentes: ${dependentes.length}`);

if (dependentes.length === 0) {
  console.log('nenhuma dependente neste Record Type — nada a comparar.');
  process.exit(0);
}

const [nome, naChamadaUnica] = dependentes[0];
console.log(`\ntestando com: ${nome}`);
console.log(`  controllerValues: ${JSON.stringify(naChamadaUnica.controllerValues)}`);
console.log(`  valores: ${naChamadaUnica.values.length}`);
console.log(`  exemplo de validFor: ${JSON.stringify(naChamadaUnica.values.slice(0, 3).map((v) => ({ value: v.value, validFor: v.validFor })))}`);

// mesma picklist, endpoint POR CAMPO
const t = Date.now();
const porCampo = await sfGet(`${V}/ui-api/object-info/Case/picklist-values/${rt}/${nome}`);
console.log(`\nENDPOINT POR CAMPO — /picklist-values/${rt}/${nome}`);
console.log(`  ${kb(porCampo)} KB · ${Date.now() - t} ms`);
console.log(`  chaves devolvidas: ${Object.keys(porCampo).join(', ')}`);
console.log(`  controllerValues: ${JSON.stringify(porCampo.controllerValues)}`);
console.log(`  valores: ${porCampo.values?.length}`);
console.log(`  exemplo de validFor: ${JSON.stringify(porCampo.values?.slice(0, 3).map((v) => ({ value: v.value, validFor: v.validFor })))}`);

// sao equivalentes?
const igualControlador = JSON.stringify(porCampo.controllerValues) === JSON.stringify(naChamadaUnica.controllerValues);
const igualValores = JSON.stringify(porCampo.values) === JSON.stringify(naChamadaUnica.values);
console.log(`\n  controllerValues idêntico? ${igualControlador ? 'SIM' : 'NAO'}`);
console.log(`  values idêntico?           ${igualValores ? 'SIM' : 'NAO'}`);

// o record type e respeitado? compara com outro RT
const outroRt = '012Ha000002dvwdIAA';
const outro = await sfGet(`${V}/ui-api/object-info/Case/picklist-values/${outroRt}/${nome}`).catch((e) => ({ erro: e.message }));
console.log(`\n  mesmo campo em outro Record Type: ${outro.erro ? 'erro: ' + outro.erro : `${outro.values?.length} valores`}`);
console.log(`  => escopado por Record Type? ${outro.erro ? '?' : outro.values?.length !== porCampo.values?.length ? 'SIM, difere' : 'valores iguais neste caso'}`);

// e o campo controlador em si, vem junto?
const controlador = Object.keys(naChamadaUnica.controllerValues)[0];
console.log(`\n  o campo CONTROLADOR precisa de chamada própria?`);
console.log(`     controllerValues mapeia VALORES do controlador -> índice`);
console.log(`     mas não diz QUAL campo é o controlador; isso vem do object-info (controllerName)`);
console.log(`     exemplo de chave: "${controlador}"`);
