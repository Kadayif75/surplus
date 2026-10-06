import type { BarcodeMapping, Location, Product } from '../domain/types';
import type { ArticleAlias, DeliveryLine, DeliveryValidation } from './types';
import { sameReading } from './deliveryParser';
import { determineDestination } from './destinationService';

export function positiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
export function nameConsistent(name: string, product: Product): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\bcomf\b/g, 'comfort')
    .replace(/\bm\b/g, 'medium').replace(/\bl\b/g, 'large').replace(/\bs\b/g, 'small')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && w !== 'proskin');
  const tokens = normalize(name);
  const expected = normalize(product.name);
  const distinguishing = ['plus', 'extra', 'super', 'maxi', 'normal', 'medium', 'large', 'small', 'discreet', 'men', 'pants', 'comfort', 'flex'];
  return expected.every(token => tokens.includes(token)) && distinguishing.every(token => !tokens.includes(token) || expected.includes(token));
}
export function resolveProduct(articleNumber: string, products: Product[], aliases: ArticleAlias[], gtin?: string, mappings: BarcodeMapping[] = []) {
  const exact = products.find(p => p.tenaArticleNumber === articleNumber);
  const alias = aliases.find(a => a.articleNumber === articleNumber && a.verified);
  const barcode = mappings.find(m => m.rawValue === gtin && m.verified && !m.isDemo);
  return exact ?? products.find(p => p.id === alias?.productId) ?? (!articleNumber ? products.find(p => p.id === barcode?.productId) : undefined);
}
export function validateDeliveryLine(line: DeliveryLine, products: Product[], locations: Location[], aliases: ArticleAlias[], repeatedArticle = false, mappings: BarcodeMapping[] = []): DeliveryValidation {
  const product = line.newProduct ?? products.find(p => p.id === line.productId);
  const quantity = positiveInteger(line.quantityText);
  const packsPerBox = positiveInteger(line.packsPerBoxText);
  const piecesPerPack = positiveInteger(line.piecesPerPackText);
  const recognized = resolveProduct(line.articleNumber, products, aliases, line.gtin, mappings);
  const exactArticle = !!product && (product.tenaArticleNumber === line.articleNumber || aliases.some(a => a.verified && a.articleNumber === line.articleNumber && a.productId === product.id));
  const aliasAllowed = exactArticle || line.aliasConfirmed;
  const packagingMatches = !!product && (line.unit === 'verpakking' || (packsPerBox === product.packsPerBox && piecesPerPack === product.piecesPerPack));
  const converted = quantity !== undefined && (line.unit === 'verpakking' || (line.unit === 'COL' && packsPerBox !== undefined))
    ? quantity * (line.unit === 'COL' ? packsPerBox! : 1) : undefined;
  const quantityPacks = converted !== undefined && Number.isSafeInteger(converted) && converted > 0 ? converted : undefined;
  const destination = determineDestination(product?.id ?? '', line, locations);
  const knownGtin = mappings.find(m => m.rawValue === line.gtin && m.verified && !m.isDemo);
  const checks = {
    'Artikelnummer gecontroleerd gekoppeld': exactArticle,
    'Product bestaat en assortiment bevestigd': !!product && !line.newProduct && product.assortmentVerified,
    'Productnaam komt overeen': !!product && nameConsistent(line.detectedProductName, product),
    'Aantal geldig': quantityPacks !== undefined,
    'Verpakking komt overeen': packagingMatches,
    'Tweede uitlezing identiek': sameReading(line, line.secondReading),
    'Geen herhaalde artikelregel': !repeatedArticle,
    'Barcode klopt indien aanwezig': !line.gtin || (!!knownGtin && knownGtin.productId === product?.id),
    'Bestemming bevestigd': destination.verified,
  };
  const reasons = Object.entries(checks).filter(([, ok]) => !ok).map(([label]) => label);
  const confidence = !product ? 'Niet herkend' : Object.values(checks).every(Boolean) ? 'Hoge zekerheid' : 'Controle nodig';
  const barcodeConflict = !!line.gtin && (!knownGtin || knownGtin.productId !== product?.id);
  const conflictingIdentity = recognized && recognized.id !== product?.id;
  const newProductValid = !line.newProduct || (!!line.newProduct.name.trim() && !!positiveInteger(String(line.newProduct.packsPerBox)) && !!positiveInteger(String(line.newProduct.piecesPerPack)));
  const blockingReasons: string[] = [];
  if (!product) blockingReasons.push('Kies het juiste product in voorraad of bereid een gecontroleerd nieuw product voor.');
  if (!newProductValid) blockingReasons.push('Vul de naam en geldige verpakkingsgegevens van het nieuwe product in.');
  if (!line.articleNumber.trim()) blockingReasons.push('Vul het artikelnummer van de pakbon in.');
  if (product && !aliasAllowed) blockingReasons.push('Bevestig de koppeling tussen de afwijkende pakboncode en het gekozen product.');
  if (conflictingIdentity) blockingReasons.push(`Deze artikelcode is al gekoppeld aan ${recognized.name}. Kies het bijbehorende product en controleer de pakbon.`);
  if (barcodeConflict) blockingReasons.push('De gelezen barcode is onbekend of hoort bij een ander product. Controleer de barcode en productkoppeling.');
  if (quantityPacks === undefined) {
    if (quantity === undefined) blockingReasons.push('Vul bij Aantal op de bon een positief geheel getal in.');
    else if (line.unit === 'onbekend') blockingReasons.push('Kies de eenheid: COL / doos of verpakking.');
    else if (line.unit === 'COL' && packsPerBox === undefined) blockingReasons.push('Vul een positief geheel aantal verpakkingen per doos in.');
    else blockingReasons.push('Het omgerekende aantal is te groot. Controleer aantal en verpakkingen per doos.');
  }
  if (product && !packagingMatches) blockingReasons.push(`De doosinhoud op de bon (${line.packsPerBoxText || '?'} verpakkingen × ${line.piecesPerPackText || '?'} stuks) wijkt af van ${product.name} (${product.packsPerBox} × ${product.piecesPerPack}). Controleer het gekozen product en de doosinhoud op de bon of verpakking.`);
  if (!destination.verified) blockingReasons.push('Kies bij Bestemming een geldige voorraadruimte.');
  if (!line.manuallyReviewed) blockingReasons.push('Vink de regelcontrole aan nadat je artikel, product, aantal, verpakking en bestemming hebt gecontroleerd.');
  return { confidence, quantityPacks, checks, reasons,
    blockingReasons, canBook: blockingReasons.length === 0 };
}
