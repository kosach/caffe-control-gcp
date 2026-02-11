import { webhook } from './index';
import axios from 'axios';

// Mock dependencies
jest.mock('../../utils/database');
jest.mock('../../utils/mongodb');
jest.mock('../../utils/writeoffs');
jest.mock('../../utils/catalog');
jest.mock('axios');

import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';
import { getTransactionWriteOffs } from '../../utils/writeoffs';
import { getCatalog, createCatalogMap } from '../../utils/catalog';

type MockRequest = {
  method?: string;
  query?: Record<string, any>;
  body?: any;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function createMockResponse(): MockResponse {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json };
}

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('webhook', () => {
  let mockDbInstance: any;
  const mockRawHookId = 'mock-raw-hook-id-12345';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock database instance
    mockDbInstance = {
      transactions: {
        find: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
        insertMany: jest.fn()
      },
      rawHooks: {
        insertOne: jest.fn().mockResolvedValue(mockRawHookId),
        updateOne: jest.fn().mockResolvedValue(undefined)
      }
    };

    (getDatabase as jest.Mock).mockResolvedValue(mockDbInstance);

    (getSecret as jest.Mock).mockImplementation((key: string) => {
      if (key === 'poster-hook-api-key') return Promise.resolve('valid-key');
      if (key === 'poster-token') return Promise.resolve('test-poster-token');
      return Promise.resolve('mock-secret');
    });

    // Mock Poster API response
    mockedAxios.get.mockResolvedValue({
      data: {
        response: [{
          transaction_id: '123',
          date_start: '1518873040083',
          date_close: '1518873046314',
          status: '2',
          name: 'Test Waiter',
          payed_sum: '8137663',
          date_close_date: '2024-08-31 09:20:22'
        }]
      }
    });

    Object.defineProperty(axios, 'isAxiosError', {
      value: jest.fn().mockReturnValue(false),
      writable: true
    });

    // Mock getTransactionWriteOffs to return empty array by default
    (getTransactionWriteOffs as jest.Mock).mockResolvedValue([]);

    // Mock catalog functions
    const mockCatalog = [
      { id: '123', name: 'Капучино', type: 1 },
      { id: '456', name: 'Латте', type: 1 },
      { id: '789', name: 'Еспресо', type: 1 }
    ];
    (getCatalog as jest.Mock).mockResolvedValue(mockCatalog);
    (createCatalogMap as jest.Mock).mockReturnValue(
      new Map(mockCatalog.map(item => [item.id, item]))
    );
  });

  function buildRequest(overrides: Partial<MockRequest> = {}): MockRequest {
    return {
      method: 'POST',
      query: { 'api-key': 'valid-key' },
      body: {
        account: 'test_account',
        account_number: '12345',
        object: 'transaction',
        object_id: 123,
        action: 'added',
        time: '1729400000',
        verify: 'test_hash',
        data: '{"status":"2"}'
      },
      ...overrides
    };
  }

  test('returns 405 for non-POST method', async () => {
    const req = buildRequest({ method: 'GET' });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  test('returns 401 when api key missing', async () => {
    const req = buildRequest({ query: {} });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  test('returns 401 when api key invalid', async () => {
    const req = buildRequest({ query: { 'api-key': 'wrong' } });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  test('returns 500 when raw webhook cannot be stored', async () => {
    mockDbInstance.rawHooks.insertOne.mockRejectedValueOnce(new Error('DB down'));

    const req = buildRequest();
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Processing failed',
      message: 'Unexpected error'
    });
  });

  test('returns 400 when action missing', async () => {
    const req = buildRequest({
      body: {
        object_id: 123,
        data: { transaction_id: 123 }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(mockDbInstance.rawHooks.updateOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing required field: action'
    });
  });

  test('returns 400 when action invalid', async () => {
    const req = buildRequest({
      body: {
        action: 'deleted',
        object_id: 123,
        data: { transaction_id: 123 }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: expect.stringContaining('Invalid action: deleted')
    });
  });

  test('returns 400 when object_id missing', async () => {
    const req = buildRequest({
      body: {
        action: 'added',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing required field: object_id'
    });
  });

  test('skips saving to transactions for added action', async () => {
    const req = buildRequest({
      body: {
        action: 'added',
        object_id: 789,
        data: '{"status":"1"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should NOT save to transactions for 'added' action
    expect(mockDbInstance.transactions.upsert).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 789,
      action: 'added',
      saved_to_transactions: false,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('stores raw webhook and skips transactions for added action', async () => {
    const req = buildRequest(); // Default action is 'added'
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(mockDbInstance.rawHooks.insertOne).toHaveBeenCalled();
    expect(mockDbInstance.transactions.upsert).not.toHaveBeenCalled();
    expect(mockDbInstance.rawHooks.updateOne).toHaveBeenCalledWith(
      mockRawHookId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          processed: true,
          saved_to_transactions: false
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 123,
      action: 'added',
      saved_to_transactions: false,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('upserts transaction when action is changed', async () => {
    const req = buildRequest({
      body: {
        object_id: 999,
        action: 'changed',
        data: '{"status":"2","payed_sum":"7500"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should call Poster API
    expect(mockedAxios.get).toHaveBeenCalled();

    // Should upsert transaction with Poster API data
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123', // transaction_id from Poster API
      expect.objectContaining({
        transaction_id: '123',
        status: '2',
        name: 'Test Waiter'
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 999,
      action: 'changed',
      saved_to_transactions: true,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('returns 500 when transaction upsert fails', async () => {
    mockDbInstance.transactions.upsert.mockRejectedValueOnce(new Error('Write error'));

    const req = buildRequest({
      body: {
        action: 'changed',
        object_id: 42,
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Processing failed',
      message: 'Unexpected error'
    });
  });

  test('handles removed action (only stores raw, not in transactions)', async () => {
    const req = buildRequest({
      body: {
        object_id: 555,
        action: 'removed',
        data: '{"status":"3"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should NOT save to transactions for 'removed' action
    expect(mockDbInstance.transactions.upsert).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 555,
      action: 'removed',
      saved_to_transactions: false,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('handles Poster API failure gracefully', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { response: [] }
    });

    const req = buildRequest({
      body: {
        object_id: 7777,
        action: 'changed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should NOT save to transactions when API returns empty
    expect(mockDbInstance.transactions.upsert).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 7777,
      action: 'changed',
      saved_to_transactions: false,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('handles closed action (saves to transactions)', async () => {
    const req = buildRequest({
      body: {
        object_id: 8888,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should save to transactions for 'closed' action
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 8888,
      action: 'closed',
      saved_to_transactions: true,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('fetches and includes write-offs for closed transaction', async () => {
    const mockWriteOffs = [
      {
        write_off_id: '1001',
        ingredient_id: '100',
        ingredient_name: 'Coffee beans',
        weight: 0.018,
        unit: 'kg',
        cost: 12.50,
        type: 4
      },
      {
        write_off_id: '1002',
        ingredient_id: '101',
        ingredient_name: 'Milk',
        weight: 0.15,
        unit: 'l',
        cost: 4.00,
        type: 4
      }
    ];

    (getTransactionWriteOffs as jest.Mock).mockResolvedValueOnce(mockWriteOffs);

    const req = buildRequest({
      body: {
        object_id: 9999,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should fetch write-offs
    expect(getTransactionWriteOffs).toHaveBeenCalledWith(9999, 'test-poster-token');

    // Should include write-offs in transaction upsert
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        write_offs: mockWriteOffs,
        write_offs_synced_at: expect.any(Date)
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 9999,
      action: 'closed',
      saved_to_transactions: true,
      write_offs_count: 2,
      raw_hook_id: mockRawHookId
    });
  });

  test('saves transaction without write-offs when write-offs fetch fails', async () => {
    (getTransactionWriteOffs as jest.Mock).mockRejectedValueOnce(new Error('Write-offs API error'));

    const req = buildRequest({
      body: {
        object_id: 7000,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should still save transaction, just without write-offs
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        write_offs: [],
        write_offs_synced_at: null
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 7000,
      action: 'closed',
      saved_to_transactions: true,
      write_offs_count: 0,
      raw_hook_id: mockRawHookId
    });
  });

  test('enriches products with names from catalog', async () => {
    // Mock Poster API response with products
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [{
          transaction_id: '123',
          date_close: '1518873046314',
          status: '2',
          payed_sum: '15000',
          products: [
            { product_id: '123', modification_id: '0', num: '1', payed_sum: '5000' },
            { product_id: '456', modification_id: '0', num: '2', payed_sum: '10000' }
          ]
        }]
      }
    });

    const req = buildRequest({
      body: {
        object_id: 5555,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should fetch catalog
    expect(getCatalog).toHaveBeenCalledWith('test-poster-token');
    expect(createCatalogMap).toHaveBeenCalled();

    // Should save transaction with enriched products
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({
            product_id: '123',
            product_name: 'Капучино'
          }),
          expect.objectContaining({
            product_id: '456',
            product_name: 'Латте'
          })
        ])
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('saves transaction without product names when catalog fetch fails', async () => {
    (getCatalog as jest.Mock).mockRejectedValueOnce(new Error('Catalog API error'));

    // Mock Poster API response with products
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [{
          transaction_id: '123',
          date_close: '1518873046314',
          status: '2',
          products: [
            { product_id: '999', modification_id: '0', num: '1', payed_sum: '5000' }
          ]
        }]
      }
    });

    const req = buildRequest({
      body: {
        object_id: 6666,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should still save transaction with original products (no product_name)
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({
            product_id: '999'
          })
        ])
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('handles products not found in catalog (returns null for product_name)', async () => {
    // Mock Poster API response with unknown product
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [{
          transaction_id: '123',
          date_close: '1518873046314',
          status: '2',
          products: [
            { product_id: '999', modification_id: '0', num: '1', payed_sum: '5000' }
          ]
        }]
      }
    });

    const req = buildRequest({
      body: {
        object_id: 7777,
        action: 'closed',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should save with null product_name for unknown product
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({
            product_id: '999',
            product_name: null
          })
        ])
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
