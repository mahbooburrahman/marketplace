import 'express';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin' | 'system';
  status: 'email_unverified' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'banned';
  full_name: string;
  display_name: string;
  phone: string;
  avatar_path: string | null;
  location: string | null;
  email_verified: boolean;
  is_seller: boolean;
  session_hash: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
