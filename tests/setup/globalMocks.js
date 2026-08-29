jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    setIssuer: jest.fn().mockReturnThis(),
    setSubject: jest.fn().mockReturnThis(),
    setJti: jest.fn().mockReturnThis(), // ← ADDED
    sign: jest.fn().mockResolvedValue('fake-credential-jwt'),
  })),
  jwtVerify: jest.fn().mockResolvedValue({ payload: { sub: 'mock-user-id' } }),
}));
