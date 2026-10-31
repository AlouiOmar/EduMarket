import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { User } from '../modules/auth/model.js';

export type Role = 'student' | 'teacher' | 'unverified_teacher' | 'institution' | 'moderator' | 'admin';
export interface AuthRequest extends Request { auth?: { userId: string; role: Role; status: 'active' | 'pending' | 'suspended' } }

export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const cookieToken = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('edumarket_access='))?.slice('edumarket_access='.length);
  const token = cookieToken || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED'));
  let claims: jwt.JwtPayload;
  try { claims = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload; }
  catch { return next(new AppError(401, 'INVALID_TOKEN')); }
  if (typeof claims.sub !== 'string') return next(new AppError(401, 'INVALID_TOKEN'));
  try {
    const user = await User.findById(claims.sub).select('role status authVersion').lean();
    if (!user) return next(new AppError(401, 'USER_NOT_FOUND'));
    if ((user.authVersion || 0) !== (typeof claims.ver === 'number' ? claims.ver : 0)) return next(new AppError(401, 'INVALID_TOKEN'));
    req.auth = { userId: String(user._id), role: user.role, status: user.status || 'active' };
    next();
  } catch (error) { next(error); }
}

export async function optionalAuthenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const cookieToken = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('edumarket_access='))?.slice('edumarket_access='.length);
  const token = cookieToken || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next();
  let claims: jwt.JwtPayload;
  try { claims = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload; }
  catch { return next(new AppError(401, 'INVALID_TOKEN')); }
  if (typeof claims.sub !== 'string') return next(new AppError(401, 'INVALID_TOKEN'));
  try {
    const user = await User.findById(claims.sub).select('role status authVersion').lean();
    if (!user) return next(new AppError(401, 'USER_NOT_FOUND'));
    if ((user.authVersion || 0) !== (typeof claims.ver === 'number' ? claims.ver : 0)) return next(new AppError(401, 'INVALID_TOKEN'));
    req.auth = { userId: String(user._id), role: user.role, status: user.status || 'active' };
    next();
  } catch (error) { next(error); }
}

export function allowRoles(...roles: Role[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (req.auth?.status === 'suspended') return next(new AppError(403, 'ACCOUNT_SUSPENDED'));
    if (!req.auth || !roles.includes(req.auth.role)) return next(new AppError(403, 'FORBIDDEN'));
    next();
  };
}
