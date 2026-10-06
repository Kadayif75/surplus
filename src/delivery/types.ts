import type { Product } from '../domain/types';

export interface ParsedDeliveryLine {
  articleNumber: string; detectedProductName: string; quantityText: string;
  unit: 'COL' | 'verpakking' | 'onbekend'; packsPerBoxText: string; piecesPerPackText: string;
  rawText: string; gtin?: string; sourcePage?: number;
}
export interface DeliveryLine extends ParsedDeliveryLine {
  id: string; secondReading?: ParsedDeliveryLine; productId: string;
  destinationLocationId: string; manuallyReviewed: boolean;
  aliasConfirmed: boolean; newProduct?: Product; excluded: boolean; exclusionReason: string;
}
export interface DeliveryDraft {
  id: string; operationId: string; deliveryNumber: string; supplier: string;
  deliveryDate: string; createdAt: string; imageHash: string; lines: DeliveryLine[];
  declaredColli?: number; completenessConfirmed: boolean;
}
export interface ArticleAlias { articleNumber: string; productId: string; verified: boolean; reason: string }
export interface ProductLocationRule { id: string; productId: string; locationId: string; verified: boolean; reason: string; priority?: number }
export interface DeliveryValidation {
  confidence: 'Hoge zekerheid' | 'Controle nodig' | 'Niet herkend';
  quantityPacks?: number; canBook: boolean; reasons: string[]; blockingReasons: string[];
  checks: Record<string, boolean>;
}
export interface ProcessedLine {
  id: string; articleNumber: string; productId: string; productName: string;
  quantityPacks: number; locationId: string; confidence: DeliveryValidation['confidence'];
  manuallyReviewed: boolean; checks: Record<string, boolean>; rawText: string; sourcePage?: number;
}
export interface DeliveryNote {
  id: string; operationId: string; identityKey: string; fingerprint: string; imageHash?: string;
  deliveryNumber: string; supplier: string; deliveryDate: string; createdAt: string; processedAt: string;
  status: 'Verwerkt'; actor: 'Demogebruiker'; lines: ProcessedLine[];
  excludedLines: { rawText: string; reason: string; sourcePage?: number }[];
  movementIds: string[]; commandSignature: string;
}
