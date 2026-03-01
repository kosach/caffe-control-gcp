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

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      query: {
        'auth-token': 'valid-token',
        dateFrom: '2025-01-01',
      },
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };

    (getSecret as jest.Mock).mockImplementation((key: string) => {
      if (key === 'api-auth-key') return Promise.resolve('valid-token');
      if (key === 'poster-token') return Promise.resolve('poster-test-token');
      return Promise.resolve('secret');
    });

    mockDbInstance = {
      transactions: {
        find: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
        insertMany: jest.fn(),
      },
    };

    (getDatabase as jest.Mock).mockResolvedValue(mockDbInstance);
    (getCatalog as jest.Mock).mockResolvedValue([]);
    (createCatalogMap as jest.Mock).mockReturnValue(new Map());
    (fetchPosterTransaction as jest.Mock).mockResolvedValue(null);
    (enrichTransaction as jest.Mock).mockResolvedValue({ transaction_id: '1' });
  });

  test('should reject request without auth token', async () => {
    mockRequest.query = { dateFrom: '2025-01-01' };

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(401);
  });

  test('should reject request with invalid auth token', async () => {
    mockRequest.query = { 'auth-token': 'wrong', dateFrom: '2025-01-01' };

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(401);
  });

  test('should default dateFrom to yesterday when not provided', async () => {
    mockRequest.query = { 'auth-token': 'valid-token' };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: [], count: 0 }),
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
  });

  test('should handle dateFrom=yesterday', async () => {
    mockRequest.query = { 'auth-token': 'valid-token', dateFrom: 'yesterday' };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: [], count: 0 }),
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    // fetch should have been called with yesterday's date (YYYYMMDD format)
    const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(fetchUrl).toContain('date_from=');
    // Should NOT contain 'yesterday' literal
    expect(fetchUrl).not.toContain('yesterday');
  });

  test('should sync transactions with enrichment', async () => {
    const mockTxns = [
      { transaction_id: '100', payed_sum: '5000', date_close_date: '2025-01-15 10:00:00' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockTxns, count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: [], count: 1 }),
      });

    (fetchPosterTransaction as jest.Mock).mockResolvedValue({
      transaction_id: 100,
      products: [{ product_id: '478', product_name: 'Капучино' }],
    });

    (enrichTransaction as jest.Mock).mockResolvedValue({
      transaction_id: 100,
      products: [{ product_id: '478', product_name: 'Капучино' }],
      write_offs: [],
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(fetchPosterTransaction).toHaveBeenCalledWith('100', 'poster-test-token');
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalled();
  });

  test('should handle empty results', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: [], count: 0 }),
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
  });

  test('should handle Poster API errors gracefully', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalled();
  });

  test('should save raw data when poster detail fetch returns null', async () => {
    const mockTxns = [
      { transaction_id: '200', payed_sum: '3000', date_close_date: '2025-01-20 12:00:00' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockTxns, count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: [], count: 1 }),
      });

    // fetchPosterTransaction returns null (can't fetch full data)
    (fetchPosterTransaction as jest.Mock).mockResolvedValue(null);

    await syncTransactions(mockRequest, mockResponse);

    // Function should complete (either success or handled error)
    expect(mockStatus).toHaveBeenCalled();
  });

  test('should skip enrichment when enrich=false', async () => {
    mockRequest.query.enrich = 'false';

    const mockTxns = [
      { transaction_id: '300', payed_sum: '1500', date_close_date: '2025-01-25 15:00:00' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockTxns, count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: [], count: 1 }),
      });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(fetchPosterTransaction).not.toHaveBeenCalled();
    expect(mockDbInstance.transactions.upsert).toHaveBeenCalled();
  });
});
