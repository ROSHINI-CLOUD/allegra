const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '::'
  ) {
    return true;
  }

  const match = IPV4.exec(host);
  if (!match) {
    return false;
  }

  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === undefined || b === undefined) {
    return true;
  }
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function parsePublicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('URL must be https.');
  }
  if (url.username || url.password) {
    throw new Error('URL must not include credentials.');
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error('URL must not target a private host.');
  }
  return url;
}

export function parseTrustedProviderUrl(value: string, production: boolean): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider URL must be http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Provider URL must not include credentials.');
  }
  if (production) {
    return parsePublicHttpsUrl(value).toString().replace(/\/+$/, '');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
