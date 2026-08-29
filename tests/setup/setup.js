// tests/setup.js
jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue('fake-jwt-token'),
  })),
  jwtVerify: jest.fn().mockResolvedValue({ payload: { sub: 'mock-user-id' } }),
  // If other named exports are used, add them here.
}));
