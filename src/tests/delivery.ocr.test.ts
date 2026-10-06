/// <reference types="node" />
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { describe, expect, it } from 'vitest';
import { seedProducts, seedLocations } from '../data/seed';
import { readWithWorker } from '../delivery/deliveryOcr';
import { resolveProduct, validateDeliveryLine } from '../delivery/deliveryValidation';
import { sameReading } from '../delivery/deliveryParser';
import { emptyLine } from '../delivery/DeliveryReview';

const fixture = (name: string) => path.resolve('src/tests/fixtures/delivery',name);
async function recognize(file: string, width=1500, height=1000) {
  const worker = await createWorker('nld',1,{langPath:path.resolve('public/ocr/language'),cacheMethod:'none'});
  try { return await readWithWorker(worker,await fs.readFile(file),width,height); }
  finally { await worker.terminate(); }
}
describe('Werkelijke lokale OCR met synthetische afbeeldingen', () => {
  it('dezelfde duidelijke bon drie keer: stabiele artikelcodes, aantallen en zekerheid', async () => {
    const results = [];
    for(let run=0;run<3;run++) {
      const result=await recognize(fixture('clear.png'));
      expect(result.lines).toHaveLength(3);
      expect(result.lines.map(l=>[l.articleNumber,l.quantityText])).toEqual([['760364','1'],['750651','3'],['761531','1']]);
      expect(result.lines.filter(l=>!sameReading(l,l.secondReading))).toEqual([]);
      const verifiedProducts=seedProducts.map(p=>({...p,assortmentVerified:true}));
      const validations=result.lines.map(parsed=>validateDeliveryLine({...emptyLine(),...parsed,productId:resolveProduct(parsed.articleNumber,verifiedProducts,[])!.id,destinationLocationId:'H2',manuallyReviewed:true},verifiedProducts,seedLocations,[]));
      expect(validations.every(v=>v.confidence==='Hoge zekerheid')).toBe(true);
      results.push(validations.map(v=>[v.quantityPacks,v.confidence]));
    }
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  },60000);
  it.each(['slanted.png','dark.png','blurry.png','cropped.png','unknown.png','difficult.png'])('%s: geen ontvangst mogelijk zonder controle en bestemming', async name => {
    const result=await recognize(fixture(name),1500,name==='cropped.png'?485:1000);
    for(const parsed of result.lines) {
      const v=validateDeliveryLine({...emptyLine(),...parsed,productId:resolveProduct(parsed.articleNumber,seedProducts,[])?.id??''},seedProducts,seedLocations,[]);
      expect(v.canBook).toBe(false); expect(v.confidence).not.toBe('Hoge zekerheid');
    }
    if(name==='unknown.png') expect(result.lines.some(l=>l.articleNumber==='999999')).toBe(true);
  },60000);
});
describe.skipIf(!process.env.SV_REAL_PAKBON)('Echte aangeleverde pakbon (optioneel lokaal, nooit gepubliceerd)',()=>{
  it('drie analyses houden afwijkende codes en onzekerheden zichtbaar', async()=>{
    const outputs=[];
    for(let run=0;run<3;run++) {
      const result=await recognize(process.env.SV_REAL_PAKBON!,1920,1440);
      const articleLines=result.lines.filter(l=>/^\d+$/.test(l.articleNumber));
      expect(articleLines.length).toBeGreaterThanOrEqual(9);
      expect(articleLines.some(l=>l.articleNumber==='79157202')).toBe(true);
      expect(articleLines.some(l=>l.articleNumber==='76153109')).toBe(true);
      for(const parsed of result.lines) {
        const validation=validateDeliveryLine({...emptyLine(),...parsed,productId:resolveProduct(parsed.articleNumber,seedProducts,[])?.id??''},seedProducts,seedLocations,[]);
        expect(validation.canBook).toBe(false); expect(validation.confidence).not.toBe('Hoge zekerheid');
      }
      outputs.push(result.lines.map(l=>[l.articleNumber,l.quantityText,l.packsPerBoxText,l.piecesPerPackText]));
    }
    expect(outputs[1]).toEqual(outputs[0]);expect(outputs[2]).toEqual(outputs[0]);
  },60000);
});
