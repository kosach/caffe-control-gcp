import { syncTransactions } from './index';

// Mock dependencies
jest.mock('../../utils/mongodb');

import { connectToDatabase, getSecret } from '../../utils/mongodb';

// Mock global fetch
global.fetch = jest.fn();

describe('syncTransactions', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      query: {
        'auth-token': 'valid-token'
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

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should reject request without auth token', async () => {
    mockRequest.query = {};

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

  test('should sync new transactions successfully', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000' },
      { transaction_id: '2', payed_sum: '2000' }
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

    // Mock MongoDB insertMany
    const mockInsertMany = jest.fn().mockResolvedValue({
      insertedCount: 2
    });

    const mockCollection = {
      insertMany: mockInsertMany
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
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

    expect(mockInsertMany).toHaveBeenCalledWith(
      mockTransactions,
      { ordered: false }
    );
  });

  test('should handle duplicate transactions gracefully', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000' },
      { transaction_id: '2', payed_sum: '2000' },
      { transaction_id: '3', payed_sum: '3000' }
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

    // Mock MongoDB insertMany with duplicate key error
    const mockInsertMany = jest.fn().mockRejectedValue({
      code: 11000,
      writeErrors: [
        { index: 0, code: 11000 },
        { index: 2, code: 11000 }
      ],
      result: {
        nInserted: 1
      }
    });

    const mockCollection = {
      insertMany: mockInsertMany
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
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

  test('should process multiple pages', async () => {
    const page1Transactions = Array.from({ length: 100 }, (_, i) => ({
      transaction_id: `${i + 1}`,
      payed_sum: '1000'
    }));

    const page2Transactions = Array.from({ length: 50 }, (_, i) => ({
      transaction_id: `${i + 101}`,
      payed_sum: '2000'
    }));

    // Mock Poster API responses for 2 pages
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: page1Transactions,
          count: 150
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: page2Transactions,
          count: 150
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: [],
          count: 150
        })
      } as Response);

    const mockInsertMany = jest.fn()
      .mockResolvedValueOnce({ insertedCount: 100 })
      .mockResolvedValueOnce({ insertedCount: 50 });

    const mockCollection = {
      insertMany: mockInsertMany
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        totalRows: 150,
        affectedRows: 150,
        affectedWithError: 0,
        pagesProcessed: 2
      }
    });

    expect(mockInsertMany).toHaveBeenCalledTimes(2);
  });

  test('should apply date filters correctly', async () => {
    mockRequest.query = {
      'auth-token': 'valid-token',
      dateFrom: '2025-01-01 00:00:00',
      dateTo: '2025-01-31 23:59:59'
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 0
      })
    } as Response);

    const mockCollection = {
      insertMany: jest.fn()
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('dateFrom=2025-01-01+00%3A00%3A00'),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('dateTo=2025-01-31+23%3A59%3A59'),
      expect.any(Object)
    );
  });

  test('should apply status filter correctly', async () => {
    mockRequest.query = {
      'auth-token': 'valid-token',
      status: 'accepted'
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 0
      })
    } as Response);

    const mockCollection = {
      insertMany: jest.fn()
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('status=accepted'),
      expect.any(Object)
    );
  });

  test('should handle empty results', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [],
        count: 0
      })
    } as Response);

    const mockCollection = {
      insertMany: jest.fn()
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

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

    const mockCollection = {
      insertMany: jest.fn()
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'Internal server error',
      message: expect.stringContaining('Poster API error')
    });
  });

  test('should handle database errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: [{ transaction_id: '1' }],
        count: 1
      })
    } as Response);

    const mockInsertMany = jest.fn().mockRejectedValue(new Error('Database connection failed'));

    const mockCollection = {
      insertMany: mockInsertMany
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await syncTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: 'Internal server error',
      message: 'Database connection failed'
    });
  });
});
