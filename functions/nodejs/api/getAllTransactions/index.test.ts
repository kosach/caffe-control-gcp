import { getAllTransactions } from './index';

// Mock dependencies
jest.mock('../../utils/mongodb');

import { connectToDatabase, getSecret } from '../../utils/mongodb';

describe('getAllTransactions', () => {
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

    (getSecret as jest.Mock).mockResolvedValue('valid-token');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return all transactions when no date filter', async () => {
    const mockTransactions = [
      { transaction_id: '1', payed_sum: '1000' },
      { transaction_id: '2', payed_sum: '2000' }
    ];

    const mockCursor = {
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(mockTransactions)
    };

    const mockCollection = {
      find: jest.fn().mockReturnValue(mockCursor)
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(mockTransactions);
    expect(mockCursor.limit).toHaveBeenCalledWith(100);
    expect(mockCollection.find).toHaveBeenCalledWith({});
  });

  test('should filter by date range', async () => {
    const mockCursor = {
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([])
    };

    mockRequest.query = {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      'auth-token': 'valid-token'
    };

    const mockCollection = {
      find: jest.fn().mockReturnValue(mockCursor)
    };

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: {
        collection: jest.fn().mockReturnValue(mockCollection)
      }
    });

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockCollection.find).toHaveBeenCalledWith({
      date_close_date: {
        $gte: '2025-01-01 00:00:00',
        $lte: '2025-01-31 23:59:59'
      }
    });
  });

  test('should handle errors gracefully', async () => {
    (connectToDatabase as jest.Mock).mockRejectedValue(new Error('Connection failed'));

    await getAllTransactions(mockRequest, mockResponse);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: 'Connection failed'
    });
  });
});
