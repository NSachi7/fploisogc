export function isPast(iso: string): boolean {
  return Date.now() > new Date(iso).getTime();
}

export function nowMs(): number {
  return Date.now();
}
