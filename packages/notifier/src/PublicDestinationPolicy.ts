import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedHostAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface HostAddressResolver {
  lookup(hostname: string): Promise<readonly ResolvedHostAddress[]>;
}

export interface ValidatedWebhookDestination {
  readonly url: URL;
  readonly addresses: readonly ResolvedHostAddress[];
}

export type WebhookDestinationErrorCode = 'INVALID_CONFIG' | 'DESTINATION_BLOCKED';

export class WebhookDestinationError extends Error {
  constructor(
    readonly code: WebhookDestinationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WebhookDestinationError';
  }
}

export class NodeHostAddressResolver implements HostAddressResolver {
  async lookup(hostname: string): Promise<readonly ResolvedHostAddress[]> {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.flatMap((answer) =>
      answer.family === 4 || answer.family === 6
        ? [{ address: answer.address, family: answer.family }]
        : [],
    );
  }
}

export class PublicDestinationPolicy {
  private readonly resolutionTimeoutMs: number;

  constructor(
    private readonly resolver: HostAddressResolver = new NodeHostAddressResolver(),
    resolutionTimeoutMs = 5_000,
  ) {
    if (
      !Number.isInteger(resolutionTimeoutMs) ||
      resolutionTimeoutMs < 1 ||
      resolutionTimeoutMs > 30_000
    ) {
      throw new Error('Webhook DNS timeout is outside its safe range.');
    }
    this.resolutionTimeoutMs = resolutionTimeoutMs;
  }

  async resolve(value: string): Promise<ValidatedWebhookDestination> {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new WebhookDestinationError('INVALID_CONFIG', 'Webhook destination is invalid.', error);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw blockedDestination();
    }
    if (url.username !== '' || url.password !== '') throw blockedDestination();

    const hostname = normalizedHostname(url.hostname);
    if (hostname === '' || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw blockedDestination();
    }

    const literalFamily = isIP(hostname);
    if (literalFamily !== 0) {
      const answer = { address: hostname, family: literalFamily } as ResolvedHostAddress;
      if (!isPublicAddress(answer)) throw blockedDestination();
      return { url, addresses: [answer] };
    }

    let addresses: readonly ResolvedHostAddress[];
    try {
      addresses = await withTimeout(this.resolver.lookup(hostname), this.resolutionTimeoutMs);
    } catch (error) {
      throw new WebhookDestinationError(
        'DESTINATION_BLOCKED',
        'Webhook destination could not be safely resolved.',
        error,
      );
    }
    if (addresses.length === 0 || addresses.some((answer) => !isPublicAddress(answer))) {
      throw blockedDestination();
    }
    return { url, addresses: [...addresses] };
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Webhook DNS resolution timed out.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function normalizedHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return withoutBrackets.replace(/\.$/u, '').toLowerCase();
}

function blockedDestination(): WebhookDestinationError {
  return new WebhookDestinationError(
    'DESTINATION_BLOCKED',
    'Webhook destination is not permitted.',
  );
}

function isPublicAddress(answer: ResolvedHostAddress): boolean {
  if (isIP(answer.address) !== answer.family) return false;
  return answer.family === 4 ? isPublicIpv4(answer.address) : isPublicIpv6(answer.address);
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const value = parts.reduce((result, part) => (result * 256 + part) >>> 0, 0);
  return ![
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([base, prefix]) => inIpv4Cidr(value, String(base), Number(prefix)));
}

function inIpv4Cidr(value: number, base: string, prefix: number): boolean {
  const baseValue = base
    .split('.')
    .map(Number)
    .reduce((result, part) => (result * 256 + part) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value === undefined) return false;
  const globalPrefix = value >> 125n;
  if (globalPrefix !== 1n) return false; // 2000::/3
  const documentationPrefix = 0x20010db8n;
  return value >> 96n !== documentationPrefix;
}

function ipv6ToBigInt(address: string): bigint | undefined {
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) return undefined;
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const left = parseIpv6Parts(halves[0] ?? '');
  const right = parseIpv6Parts(halves[1] ?? '');
  if (left === undefined || right === undefined) return undefined;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
    return undefined;
  const parts = [...left, ...Array<number>(missing).fill(0), ...right];
  if (parts.length !== 8) return undefined;
  return parts.reduce((result, part) => (result << 16n) | BigInt(part), 0n);
}

function parseIpv6Parts(value: string): number[] | undefined {
  if (value === '') return [];
  const textParts = value.split(':');
  const parts: number[] = [];
  for (const part of textParts) {
    if (part.includes('.')) {
      const ipv4 = part.split('.').map(Number);
      if (
        ipv4.length !== 4 ||
        ipv4.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
      )
        return undefined;
      parts.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
    } else {
      if (!/^[0-9a-f]{1,4}$/iu.test(part)) return undefined;
      parts.push(Number.parseInt(part, 16));
    }
  }
  return parts;
}
