import {
  enrichProducts,
  fetchPosterTransaction,
  enrichTransaction,
  TransactionProduct,
  PosterTransaction
} from './enrichment';
import { CatalogItem } from './catalog';

// Mock dependencies
jest.mock('./catalog');
jest.mock('./writeoffs');
jest.mock('axios');

import { getCatalog, createCatalogMap } from './catalog';
import { getTransactionWriteOffs } from './writeoffs';
import axios from 'axios';

describe('Enrichment Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enrichProducts', () => {
    const mockCatalog: CatalogItem[] = [
      { id: '1', name: 'Espresso', type: 2 },
      { id: '2', name: 'Latte', type: 2 }
    ];

    const mockProducts: TransactionProduct[] = [
      { product_id: '1', modification_id: '0', num: '1', payed_sum: '5000' },
      { product_id: '2', modification_id: '0', num: '2', payed_sum: '8000' },
      { product_id: '99', modification_id: '0', num: '1', payed_sum: '3000' }
    ];

    test('should enrich products with names from catalog', () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = enrichProducts(mockProducts, catalogMap);

      expect(result[0].product_name).toBe('Espresso');
      expect(result[1].product_name).toBe('Latte');
    });

    test('should set product_name to null when product not in catalog', () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = enrichProducts(mockProducts, catalogMap);

      expect(result[2].product_name).toBeNull();
    });

    test('should preserve original product fields', () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = enrichProducts(mockProducts, catalogMap);

      expect(result[0].product_id).toBe('1');
      expect(result[0].num).toBe('1');
      expect(result[0].payed_sum).toBe('5000');
    });

    test('should return empty array for empty input', () => {
      const catalogMap = new Map<string, CatalogItem>();
      const result = enrichProducts([], catalogMap);

      expect(result).toEqual([]);
    });
  });

  describe('fetchPosterTransaction', () => {
    test('should fetch transaction from Poster API', async () => {
      const mockTxn: PosterTransaction = {
        transaction_id: 12345,
        date_close_date: '2025-01-15 10:00:00',
        products: []
      };

      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { response: [mockTxn] }
      });

      const result = await fetchPosterTransaction(12345, 'test-token');

      expect(result).toEqual(mockTxn);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('dash.getTransaction'),
        expect.objectContaining({ timeout: 10000 })
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('transaction_id=12345'),
        expect.any(Object)
      );
    });

    test('should return null when response is empty', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { response: [] }
      });

      const result = await fetchPosterTransaction(12345, 'test-token');

      expect(result).toBeNull();
    });

    test('should return null on error', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchPosterTransaction(12345, 'test-token');

      expect(result).toBeNull();
    });

    test('should accept string transaction ID', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { response: [{ transaction_id: 1, date_close_date: '2025-01-01' }] }
      });

      await fetchPosterTransaction('1', 'test-token');

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('transaction_id=1'),
        expect.any(Object)
      );
    });
  });

  describe('enrichTransaction', () => {
    const mockTransaction: PosterTransaction = {
      transaction_id: 100,
      date_close_date: '2025-01-15 10:00:00',
      products: [
        { product_id: '1', modification_id: '0', num: '1', payed_sum: '5000' }
      ]
    };

    const mockCatalog: CatalogItem[] = [
      { id: '1', name: 'Espresso', type: 2 }
    ];

    beforeEach(() => {
      (getCatalog as jest.Mock).mockResolvedValue(mockCatalog);
      (createCatalogMap as jest.Mock).mockImplementation((items: CatalogItem[]) =>
        new Map(items.map(item => [item.id, item]))
      );
      (getTransactionWriteOffs as jest.Mock).mockResolvedValue([
        { write_off_id: '1', cost: 5.0 }
      ]);
    });

    test('should enrich transaction with product names and write-offs', async () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(result.products).toBeDefined();
      expect(Array.isArray(result.products)).toBe(true);
      expect(result.write_offs).toBeDefined();
      expect(result.transaction_id).toBe(100);
    });

    test('should set products_enriched_at when products are enriched', async () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(result.products_enriched_at).toBeInstanceOf(Date);
    });

    test('should set write_offs_synced_at when write-offs are returned', async () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(result.write_offs_synced_at).toBeInstanceOf(Date);
    });

    test('should set products_enriched_at to null when no products', async () => {
      const txnNoProducts: PosterTransaction = {
        ...mockTransaction,
        products: []
      };
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(txnNoProducts, 'test-token', catalogMap);

      expect(result.products_enriched_at).toBeNull();
    });

    test('should set write_offs_synced_at to null when no write-offs', async () => {
      (getTransactionWriteOffs as jest.Mock).mockResolvedValue([]);
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(result.write_offs_synced_at).toBeNull();
    });

    test('should fetch catalog when catalogMap is not provided', async () => {
      await enrichTransaction(mockTransaction, 'test-token');

      expect(getCatalog).toHaveBeenCalledWith('test-token');
    });

    test('should not fetch catalog when catalogMap is provided', async () => {
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(getCatalog).not.toHaveBeenCalled();
    });

    test('should handle write-offs fetch error gracefully', async () => {
      (getTransactionWriteOffs as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      const catalogMap = new Map(mockCatalog.map(item => [item.id, item]));
      const result = await enrichTransaction(mockTransaction, 'test-token', catalogMap);

      expect(result.write_offs).toEqual([]);
    });
  });
});
