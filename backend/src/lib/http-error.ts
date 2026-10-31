/** Error 4xx yang aman ditampilkan ke klien (ditangani error handler di server.ts). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} tidak ditemukan`);
