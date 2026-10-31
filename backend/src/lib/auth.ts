// Autentikasi & otorisasi bersama untuk seluruh modul.
// CATATAN PRODUKSI: header `x-agent-id` hanyalah simulasi login — ganti dengan JWT.
import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { HttpError } from "./http-error";
import { prisma } from "./prisma";

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

export async function requireAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  const agentId = req.header("x-agent-id");
  const user = agentId
    ? await prisma.user.findFirst({
        where: { id: agentId, isActive: true },
        select: { id: true, name: true, role: true },
      })
    : null;
  if (!user) return next(new HttpError(401, "Agent tidak terautentikasi"));
  res.locals.user = user satisfies AuthUser;
  next();
}

export const currentUser = (res: Response): AuthUser => res.locals.user as AuthUser;

/** Manager & admin melihat semua data; sales agent hanya data miliknya. */
export const isManager = (user: AuthUser): boolean => user.role === "ADMIN" || user.role === "SALES_MANAGER";

/** Filter Prisma `where` berbasis kepemilikan (dipakai di semua query list). */
export const ownerScope = (user: AuthUser): { ownerId?: string } => (isManager(user) ? {} : { ownerId: user.id });

/** Lempar 404 (bukan 403) bila bukan pemilik — tidak membocorkan keberadaan data. */
export function assertOwner(user: AuthUser, ownerId: string, what: string): void {
  if (!isManager(user) && ownerId !== user.id) throw new HttpError(404, `${what} tidak ditemukan`);
}

/** Hanya manager/admin (mis. membuat & meluncurkan kampanye broadcast). */
export function assertManager(user: AuthUser, action: string): void {
  if (!isManager(user)) throw new HttpError(403, `Hanya manager yang boleh ${action}`);
}
