import ExcelJS from 'exceljs';
import JSZip from 'jszip';
export async function mergeFixture(name: string, boxes?: number, count = 1, weeks = 2, unit = 'Dozen'): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bewonersoverzicht'); const advice = workbook.addWorksheet('Adviesbestelling in weken');
  workbook.addWorksheet('Bedkaart'); workbook.addWorksheet('Lijst', { state: 'hidden' }); workbook.addWorksheet('check', { state: 'hidden' }); const catalog = workbook.addWorksheet('Totaal', { state: 'hidden' });
  sheet.getCell('A1').value = 'BEWONERSOVERZICHT'; sheet.getCell('A1').font = { color: { argb: 'FF008000' }, bold: true };
  sheet.getCell('A6').value = 'Naam:'; sheet.getCell('R6').value = 'TENA Discreet'; sheet.getCell('S6').value = 'Stuks';
  for (let row = 8; row <= 11; row++) { sheet.getCell(`E${row}`).value = row % 2 ? 'N' : 'D'; sheet.getCell(`B${row}`).value = { formula: `A${row}&"_${row % 2 ? 'N' : 'D'}"`, result: '' }; sheet.getCell(`AA${row}`).value = 0; sheet.getCell(`AB${row}`).value = { formula: `ROW(A${row})`, result: row }; sheet.getCell(`R${row}`).dataValidation = { type: 'list', formulae: ['ForMen'] }; sheet.getCell(`R${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008000' } }; }
  for (const row of [8, 10]) for (const column of ['A', 'C', 'D']) sheet.mergeCells(`${column}${row}:${column}${row + 1}`);
  for (let index = 0; index < count; index++) { const row = 8 + index * 2; sheet.getCell(`A${row}`).value = `${name}-${index+1}`; sheet.getCell(`C${row}`).value = index + 1; sheet.getCell(`R${row}`).value = 'Discreet Mini'; sheet.getCell(`S${row}`).value = 2; sheet.getCell(`R${row+1}`).value = 'Discreet Mini'; sheet.getCell(`S${row+1}`).value = 1; }
  workbook.definedNames.add('Bewonersoverzicht!$A$8:$A$11', 'patient'); sheet.pageSetup.printArea = 'A1:Y11';
  advice.getCell('A9').value = 'Art.nr.'; advice.getCell('J4').value = weeks; advice.getCell('M9').value = unit;
  for (const [cell, val] of [['A11', '760364'], ['B11', 'Discreet Mini'], ['C11', 'TENA Discreet Mini'], ['D11', 6], ['E11', 30]] as const) catalog.getCell(cell).value = val;
  for (const [target, origin] of [['A11','A11'], ['B11','B11'], ['C11','C11'], ['E11','D11'], ['F11','E11']] as const) advice.getCell(target).value = { formula: `Totaal!${origin}`, result: catalog.getCell(origin).value as string | number };
  advice.getCell('D11').value = { formula: 'SUMIF(Bewonersoverzicht!R:R,B11,Bewonersoverzicht!S:S)', result: 999 }; // Deliberately stale: merge must use actual resident entries.
  for (const [cell, formula] of [['I11','D11*7*$J$4/(E11*F11)'], ['J11','ROUNDUP(I11,0)'], ['K11','D11*7*$J$4/F11'], ['L11','ROUNDUP(K11,0)']] as const) advice.getCell(cell).value = { formula, result: 999 };
  if (boxes !== undefined) advice.getCell('M11').value = boxes;
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer()); zip.file('xl/vbaProject.bin', new Uint8Array([10,20,30,40]));
  return Uint8Array.from(await zip.generateAsync({ type: 'uint8array' })).buffer;
}
