import { syncTransactions } from './index';

// Mock dependencies
jest.mock('../../utils/database');
jest.mock('../../utils/mongodb');

import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';

// Mock global fetch
global.fetch = jest.fn();

describe('syncTransactions', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockDbInstance: any;

  beforeEach(() => {
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
        upsert: jest.fn(),
        insertMany: jest.fn()
      },
      rawHooks: {
        insertOne: jest.fn(),
        updateOne: jest.fn()
      }
    };

    (getDatabase as jest.Mock).mockResolvedValue(mockDbInstance);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      error: 'Bad Request',
      message: 'dateFrom parameter is required (format: YYYY-MM-DD)'
    });
  });

  test('should sync new transactions successfully', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000', date_close_date: '2025-01-15 10:00:00' },
      { transaction_id: '2', payed_sum: '2000', date_close_date: '2025-01-16 11:00:00' }
    ];

    // Mock Poster API response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: mockTransactions,
        count: 2
      })
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 2
      })
    } as Response);

    mockDbInstance.transactions.insertMany.mockResolvedValue({
      insertedCount: 2,
      duplicateCount: 0
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalRows: 2,
        affectedRows: 2,
        affectedWithError: 0,
        pagesProcessed: 1
      }
    });

    expect(mockDbInstance.transactions.insertMany).toHaveBeenCalledWith(mockTransactions);
  });

  test('should handle duplicate transactions gracefully', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000', date_close_date: '2025-01-15 10:00:00' },
      { transaction_id: '2', payed_sum: '2000', date_close_date: '2025-01-16 11:00:00' },
      { transaction_id: '3', payed_sum: '3000', date_close_date: '2025-01-17 12:00:00' }
    ];

    // Mock Poster API response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: mockTransactions,
        count: 3
      })
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 3
      })
    } as Response);

    // Mock insertMany with duplicates
    mockDbInstance.transactions.insertMany.mockResolvedValue({
      insertedCount: 1,
      duplicateCount: 2
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalRows: 3,
        affectedRows: 1,
        affectedWithError: 2,
        pagesProcessed: 1
      }
    });
  });

  test('should handle empty results', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 0
      })
    } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalRows: 0,
        affectedRows: 0,
        affectedWithError: 0,
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
      error: 'Internal server error',
      message: expect.stringContaining('Poster API error')
    });
  });

  test('should handle database errors', async () => {
    const mockTransactions = [
      { transaction_id: '1', date_close_date: '2025-01-15 10:00:00' }
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: mockTransactions,
        count: 1
      })
    } as Response);

    mockDbInstance.transactions.insertMany.mockRejectedValue(new Error('Database connection failed'));

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'Internal server error',
      message: 'Database connection failed'
    });
  });

  test('should stop when all transactions are older than dateFrom', async () => {
    const oldTransactions = [
      { transaction_id: '1', date_close_date: '2024-12-01 10:00:00' },
      { transaction_id: '2', date_close_date: '2024-12-15 11:00:00' }
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: oldTransactions,
        count: 2
      })
    } as Response);

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    // Should not have called insertMany since all are too old
    expect(mockDbInstance.transactions.insertMany).not.toHaveBeenCalled();
  });
});
