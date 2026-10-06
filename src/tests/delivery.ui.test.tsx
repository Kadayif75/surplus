// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DeliveryPage } from '../delivery/DeliveryPage';
import { DeliveryScanner } from '../delivery/DeliveryScanner';
import { inventory } from '../data/inventoryRepository';
import type { InventorySnapshot } from '../domain/types';

const service = vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock('../delivery/deliveryService',async original=>{
  const real=await original<typeof import('../delivery/deliveryService')>();
  return {...real,confirmDelivery:service.confirm};
});
let container: HTMLDivElement; let root: Root; let snapshot: InventorySnapshot;
const textButton=(name:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===name)!;
const labelInput=(name:string)=>[...container.querySelectorAll('label')].find(l=>l.textContent?.trim().startsWith(name))!.querySelector('input,select') as HTMLInputElement|HTMLSelectElement;
async function settleConfirmation(){ const latest=service.confirm.mock.results.at(-1); if(latest) await act(async()=>{try{await latest.value;}catch{/* Deliberate fault tests. */}}); }
async function click(name:string){ const button=textButton(name); expect(button,`Knop ${name}`).toBeDefined();const before=service.confirm.mock.calls.length;await act(async()=>button.click());if(service.confirm.mock.calls.length>before)await settleConfirmation(); }
async function enter(name:string,value:string){
  const input=labelInput(name);expect(input,`Veld ${name}`).toBeDefined();
  await act(async()=>{
    const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
  });
}
async function check(name:string){await act(async()=>labelInput(name).click());}
async function mount(){await act(async()=>root.render(<DeliveryPage data={snapshot}/>));}
async function prepare(){
  await mount(); await click('Handmatig invoeren');
  await enter('Pakbon-/leveringsnummer','UI-TEST-01');await enter('Leverancier','Fictieve leverancier');
  await enter('Artikelnummer op pakbon','760364');await enter('Gelezen productnaam','TENA Discreet Mini');
  await enter('Aantal op de bon','2');await enter('Eenheid','COL');await enter('Verpakkingen per doos','6');
  await enter('Stuks per verpakking','30');await enter('Bestemming','H1');
  await check('Ik heb artikel, product');await check('Ik heb de volledige pakbon');
}
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await inventory.initialize();await inventory.resetDemo();snapshot=await inventory.snapshot();
  const real=await vi.importActual<typeof import('../delivery/deliveryService')>('../delivery/deliveryService');service.confirm.mockReset().mockImplementation(real.confirmDelivery);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe('Pakbonroute in React-componenten met echte lokale opslag',()=>{
  it.each([1,2,3])('volledige route run %i: preview, bevestiging, historie en eenmaal boeken',async()=>{
    await prepare();expect(textButton('Ontvangst bevestigen').disabled).toBe(false);expect(container.textContent).toContain('10 → 22');
    expect(await inventory.snapshot()).toEqual(snapshot);
    await act(async()=>{textButton('Ontvangst bevestigen').click();textButton('Ontvangst bevestigen').click();});
    await settleConfirmation();
    expect(service.confirm).toHaveBeenCalledOnce();expect(container.textContent).toContain('Ontvangst bevestigd');
    expect((await inventory.db.stocks.get(['tena-760364','H1']))?.quantityPacks).toBe(22);expect(await inventory.db.deliveries.count()).toBe(1);
  });
  it('annuleren na controle boekt niets',async()=>{await prepare();await click('Annuleren / nieuwe pakbon');expect(service.confirm).not.toHaveBeenCalled();expect(await inventory.snapshot()).toEqual(snapshot);});
  it('wijziging na controle maakt bevestiging opnieuw verplicht',async()=>{await prepare();await enter('Aantal op de bon','3');expect(textButton('Ontvangst bevestigen').disabled).toBe(true);expect((labelInput('Ik heb artikel, product') as HTMLInputElement).checked).toBe(false);});
  it('afwijkende verpakking en decimale hoeveelheid blokkeren',async()=>{await prepare();await enter('Stuks per verpakking','50');await check('Ik heb artikel, product');await check('Ik heb de volledige pakbon');expect(textButton('Ontvangst bevestigen').disabled).toBe(true);await enter('Aantal op de bon','1,5');expect(textButton('Ontvangst bevestigen').disabled).toBe(true);});
  it('onzekere uitkomst na commit bewaart dezelfde opdracht voor veilige retry',async()=>{
    const real=await vi.importActual<typeof import('../delivery/deliveryService')>('../delivery/deliveryService');
    service.confirm.mockImplementationOnce(async(db,draft)=>{await real.confirmDelivery(db,draft);throw new Error('Antwoord kwijt');}).mockImplementation(real.confirmDelivery);
    await prepare();await click('Ontvangst bevestigen');expect(container.textContent).toContain('uitkomst is nog onzeker');
    snapshot=await inventory.snapshot();await mount();expect(container.textContent).toContain('10 → 22');expect(container.textContent).not.toContain('22 → 34');
    await click('Dezelfde ontvangst opnieuw proberen');expect(container.textContent).toContain('Ontvangst bevestigd');
    expect(service.confirm.mock.calls[0][1]).toEqual(service.confirm.mock.calls[1][1]);expect(await inventory.db.deliveries.count()).toBe(1);
  });
  it('herhaalde pakbon toont vorige verwerking en boekt niet opnieuw',async()=>{
    await prepare();await click('Ontvangst bevestigen');await click('Volgende pakbon');await prepare();await click('Ontvangst bevestigen');
    expect(container.textContent).toContain('Eerder verwerkt');expect(container.textContent).toContain('Er is niets opnieuw geboekt');expect(await inventory.db.deliveries.count()).toBe(1);
  });
});
describe('Pakboncamera met nagebootste camera',()=>{
  it('camera alleen na klik, geen microfoon, stopt bij verlaten scherm',async()=>{
    const stop=vi.fn();const getUserMedia=vi.fn(async()=>({getTracks:()=>[{stop}]}));
    Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia},configurable:true});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined);
    await act(async()=>root.render(<DeliveryScanner captured={vi.fn()} close={vi.fn()}/>));expect(getUserMedia).not.toHaveBeenCalled();await click('Camera starten');
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({audio:false}));await act(async()=>root.render(<p>Gesloten</p>));expect(stop).toHaveBeenCalledOnce();
  });
  it('laat ontvangen toestemming na sluiten stopt de camera',async()=>{
    const stop=vi.fn();let grant!:(value:unknown)=>void;const getUserMedia=vi.fn(()=>new Promise(resolve=>{grant=resolve;}));
    Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia},configurable:true});
    await act(async()=>root.render(<DeliveryScanner captured={vi.fn()} close={vi.fn()}/>));await click('Camera starten');await act(async()=>root.render(<p>Gesloten</p>));await act(async()=>grant({getTracks:()=>[{stop}]}));expect(stop).toHaveBeenCalledOnce();
  });
  it('geweigerde camera geeft Nederlandse uitwijkroute',async()=>{
    Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:vi.fn().mockRejectedValue(new DOMException('Test','NotAllowedError'))},configurable:true});
    await act(async()=>root.render(<DeliveryScanner captured={vi.fn()} close={vi.fn()}/>));await click('Camera starten');expect(container.textContent).toContain('geweigerd');expect(container.textContent).toContain('upload een foto');
  });
});
