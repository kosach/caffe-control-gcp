import {
  fetchTransactionWriteOffs,
  enrichWriteOffsWithCatalog,
  getTransactionWriteOffs,
  calculateWriteOffsTotalCost,
  calculateWriteOffsTotalCostNetto,
  PosterWriteOff,
  TransactionWriteOff
} from './writeoffs';
import { CatalogItem } from './catalog';

// Mock dependencies
jest.mock('./mongodb');
jest.mock('./catalog');

import { getSecret } from './mongodb';
import { getCatalog, createCatalogMap } from './catalog';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('WriteOffs Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSecret as jest.Mock).mockResolvedValue('test-poster-token');
  });

  describe('fetchTransactionWriteOffs', () => {
    const mockWriteOffs: PosterWriteOff[] = [
      {
        write_off_id: '1001',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '100',
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: '0.018',
        unit: 'kg',
        cost: 12.50,
        cost_netto: 10.42,
        time: '1507703520358'
      },
      {
        write_off_id: '1002',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '101',
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: '0.15',
        unit: 'l',
        cost: 4.00,
        cost_netto: 3.33,
        time: '1507703520358'
      }
    ];

    test('should fetch write-offs from Poster API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockWriteOffs })
      });

      const result = await fetchTransactionWriteOffs('12345');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('dash.getTransactionWriteoffs')
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('transaction_id=12345')
      );
      expect(result).toEqual(mockWriteOffs);
    });

    test('should use provided poster token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: [] })
      });

      await fetchTransactionWriteOffs('12345', 'custom-token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('token=custom-token')
      );
      expect(getSecret).not.toHaveBeenCalled();
    });

    test('should return empty array when no write-offs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: null })
      });

      const result = await fetchTransactionWriteOffs('12345');

      expect(result).toEqual([]);
    });

    test('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await expect(fetchTransactionWriteOffs('12345')).rejects.toThrow(
        'Failed to fetch write-offs: 500'
      );
    });

    test('should accept number transaction ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: [] })
      });

      await fetchTransactionWriteOffs(12345);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('transaction_id=12345')
      );
    });
  });

  describe('enrichWriteOffsWithCatalog', () => {
    const mockCatalog: CatalogItem[] = [
      { id: '100', name: 'Coffee beans', type: 4 },
      { id: '101', name: 'Milk', type: 4 },
      { id: '200', name: 'Espresso', type: 2 }
    ];

    const mockWriteOffs: PosterWriteOff[] = [
      {
        write_off_id: '1001',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '100',
        product_id: '200',
        modificator_id: '0',
        prepack_id: '0',
        weight: '0.018',
        unit: 'kg',
        cost: 12.50,
        cost_netto: 10.42,
        time: '1507703520358'
      }
    ];

    beforeEach(() => {
      (getCatalog as jest.Mock).mockResolvedValue(mockCatalog);
      (createCatalogMap as jest.Mock).mockImplementation((items: CatalogItem[]) =>
        new Map(items.map(item => [item.id, item]))
      );
    });

    test('should enrich write-offs with ingredient names', async () => {
      const result = await enrichWriteOffsWithCatalog(mockWriteOffs, mockCatalog);

      expect(result[0].ingredient_name).toBe('Coffee beans');
      expect(result[0].product_name).toBe('Espresso');
    });

    test('should convert weight to number', async () => {
      const result = await enrichWriteOffsWithCatalog(mockWriteOffs, mockCatalog);

      expect(result[0].weight).toBe(0.018);
      expect(typeof result[0].weight).toBe('number');
    });

    test('should fetch catalog if not provided', async () => {
      await enrichWriteOffsWithCatalog(mockWriteOffs);

      expect(getCatalog).toHaveBeenCalled();
    });

    test('should not fetch catalog if provided', async () => {
      await enrichWriteOffsWithCatalog(mockWriteOffs, mockCatalog);

      expect(getCatalog).not.toHaveBeenCalled();
    });

    test('should return empty array for empty input', async () => {
      const result = await enrichWriteOffsWithCatalog([]);

      expect(result).toEqual([]);
    });

    test('should handle missing catalog entries gracefully', async () => {
      const writeOffWithUnknown: PosterWriteOff[] = [{
        write_off_id: '1001',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '999',  // Not in catalog
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: '1.0',
        unit: 'kg',
        cost: 10,
        cost_netto: 8,
        time: '1507703520358'
      }];

      const result = await enrichWriteOffsWithCatalog(writeOffWithUnknown, mockCatalog);

      expect(result[0].ingredient_name).toBeUndefined();
    });

    test('should determine type as ingredient when ingredient_id is set', async () => {
      const result = await enrichWriteOffsWithCatalog(mockWriteOffs, mockCatalog);

      expect(result[0].type).toBe(4);  // ingredient
    });

    test('should determine type as modifier when modificator_id is set', async () => {
      const writeOffWithModifier: PosterWriteOff[] = [{
        ...mockWriteOffs[0],
        modificator_id: '50'
      }];

      const result = await enrichWriteOffsWithCatalog(writeOffWithModifier, mockCatalog);

      expect(result[0].type).toBe(5);  // modifier
    });

    test('should determine type as prepack when prepack_id is set', async () => {
      const writeOffWithPrepack: PosterWriteOff[] = [{
        ...mockWriteOffs[0],
        ingredient_id: '0',
        prepack_id: '30'
      }];

      const result = await enrichWriteOffsWithCatalog(writeOffWithPrepack, mockCatalog);

      expect(result[0].type).toBe(3);  // prepack
    });
  });

  describe('getTransactionWriteOffs', () => {
    const mockCatalog: CatalogItem[] = [
      { id: '100', name: 'Coffee beans', type: 4 }
    ];

    const mockWriteOffs: PosterWriteOff[] = [
      {
        write_off_id: '1001',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '100',
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: '0.018',
        unit: 'kg',
        cost: 12.50,
        cost_netto: 10.42,
        time: '1507703520358'
      }
    ];

    beforeEach(() => {
      (getCatalog as jest.Mock).mockResolvedValue(mockCatalog);
      (createCatalogMap as jest.Mock).mockImplementation((items: CatalogItem[]) =>
        new Map(items.map(item => [item.id, item]))
      );
    });

    test('should fetch and enrich write-offs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockWriteOffs })
      });

      const result = await getTransactionWriteOffs('12345');

      expect(result.length).toBe(1);
      expect(result[0].ingredient_name).toBe('Coffee beans');
      expect(result[0].weight).toBe(0.018);
    });
  });

  describe('calculateWriteOffsTotalCost', () => {
    const mockEnrichedWriteOffs: TransactionWriteOff[] = [
      {
        write_off_id: '1001',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '100',
        ingredient_name: 'Coffee beans',
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: 0.018,
        unit: 'kg',
        cost: 12.50,
        cost_netto: 10.42,
        time: '1507703520358',
        type: 4
      },
      {
        write_off_id: '1002',
        tr_product_id: '2001',
        storage_id: '1',
        ingredient_id: '101',
        ingredient_name: 'Milk',
        product_id: '0',
        modificator_id: '0',
        prepack_id: '0',
        weight: 0.15,
        unit: 'l',
        cost: 4.00,
        cost_netto: 3.33,
        time: '1507703520358',
        type: 4
      }
    ];

    test('should calculate total cost', () => {
      const result = calculateWriteOffsTotalCost(mockEnrichedWriteOffs);

      expect(result).toBe(16.50);
    });

    test('should calculate total cost netto', () => {
      const result = calculateWriteOffsTotalCostNetto(mockEnrichedWriteOffs);

      expect(result).toBe(13.75);
    });

    test('should return 0 for empty array', () => {
      expect(calculateWriteOffsTotalCost([])).toBe(0);
      expect(calculateWriteOffsTotalCostNetto([])).toBe(0);
    });

    test('should handle undefined costs', () => {
      const writeOffsWithUndefined = [
        { ...mockEnrichedWriteOffs[0], cost: undefined as any },
        mockEnrichedWriteOffs[1]
      ];

      const result = calculateWriteOffsTotalCost(writeOffsWithUndefined);

      expect(result).toBe(4.00);
    });
  });
});
