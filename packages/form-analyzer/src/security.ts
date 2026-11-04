import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium, type BrowserContext } from 'playwright';

export function validateFormUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid Google Forms URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Only HTTPS Google Forms URLs are accepted');
  const valid =
    (url.hostname === 'docs.google.com' &&
      /^\/forms\/(?:u\/\d+\/)?(?:d\/e\/|d\/)[A-Za-z0-9_-]+\/(?:viewform|edit)\/?$/.test(
        url.pathname,
      )) ||
    (url.hostname === 'forms.gle' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname));
  if (!valid) throw new Error('Unsupported Google Forms URL');
  if ([...url.searchParams.keys()].some((k) => !['usp', 'embedded', 'hl'].includes(k)))
    throw new Error('Prefilled, editing-response and unknown URL parameters are not supported');
  url.search = '';
  return url;
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 6) return false; // Deliberately require public IPv4; rejects mapped IPv6 and link-local.
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
function googleResource(host: string) {
  return [
    'docs.google.com',
    'forms.gle',
    'accounts.google.com',
    'www.google.com',
    'www.gstatic.com',
    'fonts.gstatic.com',
    'fonts.googleapis.com',
    'ssl.gstatic.com',
    'lh3.googleusercontent.com',
  ].includes(host);
}
export async function secureContext(context: BrowserContext, fixtureOrigin?: string) {
  const approved = new Set<string>();
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (fixtureOrigin && url.origin === fixtureOrigin) {
      await route.continue();
      return;
    }
    if (url.protocol !== 'https:' || url.port || !googleResource(url.hostname)) {
      await route.abort('blockedbyclient');
      return;
    }
    if (
      request.isNavigationRequest() &&
      !['docs.google.com', 'forms.gle', 'accounts.google.com', 'www.google.com'].includes(
        url.hostname,
      )
    ) {
      await route.abort();
      return;
    }
    try {
      if (!approved.has(url.hostname)) {
        const addresses = await lookup(url.hostname, { all: true, family: 4 });
        if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
          throw new Error('Non-public destination');
        approved.add(url.hostname);
      }
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}
export async function openBrowser() {
  if (process.env.VERCEL && process.platform === 'linux') {
    const { default: serverless } = await import('@sparticuz/chromium');
    return chromium.launch({
      headless: true,
      args: serverless.args,
      executablePath: await serverless.executablePath(),
    });
  }
  return chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
}
