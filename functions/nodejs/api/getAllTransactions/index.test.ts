import { getAllTransactions } from './index';

// Mock dependencies
jest.mock('../../utils/database');
jest.mock('../../utils/mongodb');

import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';

describe('getAllTransactions', () => {
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
        'auth-token': 'valid-token'
      }
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson
    };

    (getSecret as jest.Mock).mockResolvedValue('valid-token');

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return all transactions when no date filter', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000' },
      { transaction_id: '2', payed_sum: '2000' }
    ];

    mockDbInstance.transactions.find.mockResolvedValue(mockTransactions);

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(mockTransactions);
    expect(mockDbInstance.transactions.find).toHaveBeenCalledWith(
      { startDate: undefined, endDate: undefined },
      { limit: 100 }
    );
  });

  test('should filter by date range', async () => {
    mockRequest.query = {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      'auth-token': 'valid-token'
    };

    mockDbInstance.transactions.find.mockResolvedValue([]);

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockDbInstance.transactions.find).toHaveBeenCalledWith(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      { limit: 100 }
    );
  });

  test('should respect custom limit', async () => {
    mockRequest.query = {
      'auth-token': 'valid-token',
      limit: '50'
    };

    mockDbInstance.transactions.find.mockResolvedValue([]);

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockDbInstance.transactions.find).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 50 }
    );
  });

  test('should return 401 for invalid token', async () => {
    mockRequest.query['auth-token'] = 'wrong-token';

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(mockJson).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  test('should handle errors gracefully', async () => {
    (getDatabase as jest.Mock).mockRejectedValue(new Error('Connection failed'));

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: 'Connection failed'
    });
  });
});
