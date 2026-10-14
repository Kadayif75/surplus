import Dexie, { type Table } from 'dexie';
import type { Product, Location, BarcodeMapping, StockPosition, Movement } from '../domain/types';
import type { ArticleAlias, DeliveryNote, ProductLocationRule } from '../delivery/types';
import type { OrderPlan } from '../orders/types';
import type { AlertSettings, AlertState, StockAlert } from '../alerts/types';

export class InventoryDatabase extends Dexie {
  products!: Table<Product, string>;
  locations!: Table<Location, string>;
  mappings!: Table<BarcodeMapping, string>;
  stocks!: Table<StockPosition, [string, string]>;
  movements!: Table<Movement, string>;
  meta!: Table<{ key: string; value: number }, string>;
  deliveries!: Table<DeliveryNote, string>;
  articleAliases!: Table<ArticleAlias, string>;
  productLocationRules!: Table<ProductLocationRule, string>;
  orders!: Table<OrderPlan, string>;
  alertSettings!: Table<AlertSettings, string>;
  alertStates!: Table<AlertState, [string, string]>;
  stockAlerts!: Table<StockAlert, string>;
  constructor(name = 'surplus-voorraad-demo-v1') {
    super(name);
    this.version(1).stores({
      products: 'id, &tenaArticleNumber', locations: 'id',
      mappings: 'id, &rawValue, productId', stocks: '[productId+locationId], productId, locationId',
      movements: 'id, &operationId, createdAt, productId, locationId', meta: 'key',
    });
    this.version(2).stores({
      deliveries: 'id, &operationId, &identityKey, &fingerprint, imageHash, processedAt',
      articleAliases: '&articleNumber, productId', productLocationRules: 'id, productId, locationId',
    });
    this.version(3).stores({ orders: 'id, reference, status, createdAt' });
    this.version(4).stores({ alertSettings: 'id', alertStates: '[productId+locationId]', stockAlerts: 'id, status, detectedAt' });
  }
}
