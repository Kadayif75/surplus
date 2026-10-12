import type { Product, StockPosition } from '../domain/types';
export interface DemandRow { articleNumber: string; name: string; dailyPieces?: number; packsPerBox: number; piecesPerPack: number; manualDailyUse?: boolean }
export interface DemandImport { hash: string; sourceWeeks: number; rows: DemandRow[] }
export interface OrderAllocation { locationId: string; dailyPieces: number; stockPacks: number; incomingPacks: number; needPacks: number; boxes: number; orderedPacks: number; receivedPacks: number }
export interface OrderLine { product: Product; allocations: OrderAllocation[] }
export interface OrderPlan { id: string; reference: string; supplier: string; weeks: number; createdAt: string; status: 'Concept' | 'Besteld' | 'Ontvangen'; sourceHashes: Record<string, string>; lines: OrderLine[]; reviewConfirmed: boolean; newProductsConfirmed: boolean; commandSignature?: string; initialStocks?: StockPosition[]; sourceKind?: 'merged-workbooks'; residentCount?: number }
