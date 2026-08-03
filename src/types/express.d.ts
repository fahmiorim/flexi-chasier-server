declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        tenantId: string;
        nama: string;
        peran: string;
      };
    }
  }
}

export {};
