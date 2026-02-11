import {
  getCatalog,
  refreshCatalog,
  getCatalogItem,
  getCatalogItemName,
  createCatalogMap,
  CatalogItem,
  CACHE_TTL_HOURS,
  IGNORED_INGREDIENT_CATEGORIES,
  PRODUCT_TYPE_MAP
} from './catalog';

// Mock dependencies
jest.mock('./firestore');
jest.mock('./mongodb');

import { getFirestore } from './firestore';
import { getSecret } from './mongodb';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Catalog Service', () => {
  let mockFirestore: any;
  let mockCatalogRef: any;
  let mockMetadataRef: any;
  let mockItemsRef: any;
  let mockBatch: any;

  const mockCatalogItems: CatalogItem[] = [
    { id: '1', name: 'Espresso', type: 2, category_id: '10' },
    { id: '2', name: 'Latte', type: 2, category_id: '10' },
    { id: '100', name: 'Coffee beans', type: 4, category_id: '5' },
    { id: '101', name: 'Milk', type: 4, category_id: '6' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firestore mocks
    mockBatch = {
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    };

    mockMetadataRef = {
      get: jest.fn(),
      set: jest.fn()
    };

    mockItemsRef = {
      get: jest.fn()
    };

    mockCatalogRef = {
      doc: jest.fn((docId: string) => {
        if (docId === 'metadata') return mockMetadataRef;
        if (docId === 'items') return mockItemsRef;
        return { get: jest.fn(), set: jest.fn() };
      })
    };

    mockFirestore = {
      collection: jest.fn().mockReturnValue(mockCatalogRef),
      batch: jest.fn().mockReturnValue(mockBatch)
    };

    (getFirestore as jest.Mock).mockReturnValue(mockFirestore);
    (getSecret as jest.Mock).mockResolvedValue('test-poster-token');
  });

  describe('getCatalog', () => {
    test('should return cached catalog when cache is valid', async () => {
      // Cache was synced 1 hour ago
      const syncedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

      mockMetadataRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          synced_at: syncedAt,
          items_count: mockCatalogItems.length
        })
      });

      mockItemsRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ items: mockCatalogItems })
      });

      const result = await getCatalog();

      expect(result).toEqual(mockCatalogItems);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should fetch from Poster when cache is expired', async () => {
      // Cache was synced 25 hours ago
      const syncedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

      mockMetadataRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          synced_at: syncedAt,
          items_count: 0
        })
      });

      // Mock Poster API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { product_id: '1', product_name: 'Espresso', type: '2' },
              { product_id: '2', product_name: 'Latte', type: '2' }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { ingredient_id: '100', ingredient_name: 'Coffee beans', category_id: '5' }
            ]
          })
        });

      const result = await getCatalog();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.length).toBe(3);
      expect(result.find(i => i.id === '1')?.name).toBe('Espresso');
      expect(result.find(i => i.id === '100')?.type).toBe(4);
    });

    test('should fetch from Poster when no cache exists', async () => {
      mockMetadataRef.get.mockResolvedValue({
        exists: false
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });

      await getCatalog();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should use provided poster token', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });

      await getCatalog('custom-token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('token=custom-token')
      );
      expect(getSecret).not.toHaveBeenCalled();
    });

    test('should handle Firestore Timestamp objects', async () => {
      // Firestore returns Timestamp objects with toDate() method
      const syncedAt = {
        toDate: () => new Date(Date.now() - 1 * 60 * 60 * 1000)
      };

      mockMetadataRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          synced_at: syncedAt,
          items_count: mockCatalogItems.length
        })
      });

      mockItemsRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ items: mockCatalogItems })
      });

      const result = await getCatalog();

      expect(result).toEqual(mockCatalogItems);
    });
  });

  describe('refreshCatalog', () => {
    test('should always fetch fresh data from Poster', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [{ product_id: '1', product_name: 'New Product', type: '1' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });

      const result = await refreshCatalog();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.find(i => i.id === '1')?.name).toBe('New Product');
    });
  });

  describe('fetchCatalogFromPoster - filtering', () => {
    test('should filter ignored ingredient categories', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      // Include ingredients from both valid and ignored categories
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { ingredient_id: '1', ingredient_name: 'Valid ingredient', category_id: '5' },
              { ingredient_id: '2', ingredient_name: 'Ignored cat 14', category_id: '14' },
              { ingredient_id: '3', ingredient_name: 'Ignored cat 17', category_id: '17' },
              { ingredient_id: '4', ingredient_name: 'Ignored cat 4', category_id: '4' },
              { ingredient_id: '5', ingredient_name: 'Another valid', category_id: '9' }
            ]
          })
        });

      const result = await getCatalog();

      // Only valid ingredients should be included
      expect(result.length).toBe(2);
      expect(result.find(i => i.id === '1')).toBeDefined();
      expect(result.find(i => i.id === '5')).toBeDefined();
      expect(result.find(i => i.id === '2')).toBeUndefined();
      expect(result.find(i => i.id === '3')).toBeUndefined();
      expect(result.find(i => i.id === '4')).toBeUndefined();
    });

    test('should apply correct type mapping for products', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { product_id: '1', product_name: 'Prepack', type: '1' },    // prepack → 3
              { product_id: '2', product_name: 'Recipe', type: '2' },     // recipe → 2
              { product_id: '3', product_name: 'Product', type: '3' }     // product → 1
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });

      const result = await getCatalog();

      expect(result.find(i => i.id === '1')?.type).toBe(3);  // prepack
      expect(result.find(i => i.id === '2')?.type).toBe(2);  // recipe
      expect(result.find(i => i.id === '3')?.type).toBe(1);  // product
    });

    test('should set type 4 for all ingredients', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { ingredient_id: '100', ingredient_name: 'Ingredient A', category_id: '5' },
              { ingredient_id: '101', ingredient_name: 'Ingredient B', category_id: '9' }
            ]
          })
        });

      const result = await getCatalog();

      expect(result.every(i => i.type === 4)).toBe(true);
    });
  });

  describe('getCatalogItem', () => {
    beforeEach(() => {
      // Setup valid cache
      const syncedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

      mockMetadataRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ synced_at: syncedAt, items_count: mockCatalogItems.length })
      });

      mockItemsRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ items: mockCatalogItems })
      });
    });

    test('should find item by id and type', async () => {
      const result = await getCatalogItem('1', 2);

      expect(result).toEqual({ id: '1', name: 'Espresso', type: 2, category_id: '10' });
    });

    test('should return null if item not found', async () => {
      const result = await getCatalogItem('999', 1);

      expect(result).toBeNull();
    });

    test('should return null if type does not match', async () => {
      const result = await getCatalogItem('1', 1);  // Wrong type

      expect(result).toBeNull();
    });
  });

  describe('getCatalogItemName', () => {
    beforeEach(() => {
      const syncedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

      mockMetadataRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ synced_at: syncedAt, items_count: mockCatalogItems.length })
      });

      mockItemsRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ items: mockCatalogItems })
      });
    });

    test('should return item name by id', async () => {
      const name = await getCatalogItemName('100');

      expect(name).toBe('Coffee beans');
    });

    test('should return Unknown for non-existent item', async () => {
      const name = await getCatalogItemName('999');

      expect(name).toBe('Unknown');
    });
  });

  describe('createCatalogMap', () => {
    test('should create map with id as key', () => {
      const map = createCatalogMap(mockCatalogItems);

      expect(map.size).toBe(mockCatalogItems.length);
      expect(map.get('1')?.name).toBe('Espresso');
      expect(map.get('100')?.name).toBe('Coffee beans');
    });

    test('should handle empty catalog', () => {
      const map = createCatalogMap([]);

      expect(map.size).toBe(0);
    });
  });

  describe('error handling', () => {
    test('should throw error when Poster API returns error', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      await expect(getCatalog()).rejects.toThrow('Failed to fetch products: 401');
    });

    test('should throw error when ingredients API fails', async () => {
      mockMetadataRef.get.mockResolvedValue({ exists: false });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500
        });

      await expect(getCatalog()).rejects.toThrow('Failed to fetch ingredients: 500');
    });
  });

  describe('constants', () => {
    test('CACHE_TTL_HOURS should be 24', () => {
      expect(CACHE_TTL_HOURS).toBe(24);
    });

    test('IGNORED_INGREDIENT_CATEGORIES should contain expected values', () => {
      expect(IGNORED_INGREDIENT_CATEGORIES).toEqual([14, 17, 4, 6, 7, 8, 15, 18]);
    });

    test('PRODUCT_TYPE_MAP should map correctly', () => {
      expect(PRODUCT_TYPE_MAP).toEqual({
        1: 3,  // prepack
        2: 2,  // recipe
        3: 1   // product
      });
    });
  });
});
