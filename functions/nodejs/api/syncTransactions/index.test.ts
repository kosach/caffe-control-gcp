import { syncTransactions } from './index';

// Mock dependencies
jest.mock('../../utils/database');
jest.mock('../../utils/mongodb');
jest.mock('../../utils/catalog');
jest.mock('../../utils/enrichment');

import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';
import { getCatalog, createCatalogMap } from '../../utils/catalog';
import { fetchPosterTransaction, enrichTransaction } from '../../utils/enrichment';

// Mock global fetch
global.fetch = jest.fn();

describe('syncTransactions', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockDbInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      query: {
        'auth-token': 'valid-token',
        dateFrom: '2025-01-01'
      }
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson
    };

    (getSecret as jest.Mock).mockImplementation((key: string) => {
      if (key === 'api-auth-key') return Promise.resolve('valid-token');
      if (key === 'poster-token') return Promise.resolve('poster-test-token');
      return Promise.resolve('secret');
    });

    // Create mock database instance
    mockDbInstance = {
      transactions: {
        find: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
        insertMany: jest.fn()
      },
      rawHooks: {
        insertOne: jest.fn(),
        updateOne: jest.fn()
      }
    };

    (getDatabase as jest.Mock).mockResolvedValue(mockDbInstance);

    // Default catalog mocks
    (getCatalog as jest.Mock).mockResolvedValue([]);
    (createCatalogMap as jest.Mock).mockReturnValue(new Map());

    // Default enrichment mocks
    (fetchPosterTransaction as jest.Mock).mockResolvedValue(null);
    (enrichTransaction as jest.Mock).mockImplementation((txn: any) => Promise.resolve(txn));
  });

  test('should reject request without auth token', async () => {
    mockRequest.query = { dateFrom: '2025-01-01' };

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'Unauthorized'
    });
  });

  test('should reject request with invalid auth token', async () => {
    mockRequest.query['auth-token'] = 'invalid-token';

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'Unauthorized'
    });
  });

  test('should require dateFrom parameter', async () => {
    mockRequest.query = { 'auth-token': 'valid-token' };

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'dateFrom parameter is required (format: YYYY-MM-DD)'
    });
  });

  test('should sync transactions without enrichment when enrich=false', async () => {
    mockRequest.query.enrich = 'false';

    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000', date_close_date: '2025-01-15 10:00:00' },
      { transaction_id: '2', payed_sum: '2000', date_close_date: '2025-01-16 11:00:00' }
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: mockTransactions })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: [] })
      } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalFetched: 2,
        synced: 2,
        enriched: 0,
        errors: 0,
        pagesProcessed: 1
      }
    });

    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledTimes(2);
    expect(fetchPosterTransaction).not.toHaveBeenCalled();
    expect(getCatalog).not.toHaveBeenCalled();
  });

  test('should sync and enrich transactions by default', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000', date_close_date: '2025-01-15 10:00:00' },
      { transaction_id: '2', payed_sum: '2000', date_close_date: '2025-01-16 11:00:00' }
    ];
    const mockFullTxn = { transaction_id: '1', products: [] };
    const mockEnriched = { transaction_id: '1', products: [], write_offs: [] };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: mockTransactions })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: [] })
      } as Response);

    (fetchPosterTransaction as jest.Mock).mockResolvedValue(mockFullTxn);
    (enrichTransaction as jest.Mock).mockResolvedValue(mockEnriched);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalFetched: 2,
        synced: 2,
        enriched: 2,
        errors: 0,
        pagesProcessed: 1
      }
    });

    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(fetchPosterTransaction).toHaveBeenCalledTimes(2);
    expect(enrichTransaction).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledTimes(2);
  });

  test('should fall back to raw data when fetchPosterTransaction returns null', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000', date_close_date: '2025-01-15 10:00:00' }
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: mockTransactions })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: [] })
      } as Response);

    (fetchPosterTransaction as jest.Mock).mockResolvedValue(null);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        synced: 1,
        enriched: 0
      })
    });

    expect(mockDbInstance.transactions.upsert).toHaveBeenCalledWith('1', mockTransactions[0]);
  });

  test('should handle empty results', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: [] })
    } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalFetched: 0,
        synced: 0,
        enriched: 0,
        errors: 0,
        pagesProcessed: 0
      }
    });
  });

  test('should handle Poster API errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('Poster API error')
    });
  });

  test('should count per-transaction errors without failing the whole sync', async () => {
    const mockTransactions = [
      { transaction_id: '1', date_close_date: '2025-01-15 10:00:00' },
      { transaction_id: '2', date_close_date: '2025-01-15 10:00:00' }
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: mockTransactions })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: [] })
      } as Response);

    mockDbInstance.transactions.upsert
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce(undefined);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        totalFetched: 2,
        synced: 1,
        errors: 1
      })
    });
  });

  test('should use dateFrom and dateTo in Poster API URL', async () => {
    mockRequest.query.dateTo = '2025-01-31';
    mockRequest.query.enrich = 'false';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: [] })
    } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('date_from=20250101')
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('date_to=20250131')
    );
  });
});
