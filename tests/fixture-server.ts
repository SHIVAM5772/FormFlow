import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
export async function fixtureServer() {
  const submitted: URLSearchParams[] = [];
  let unknown = false;
  let confirmation = 'Your response has been recorded';
  let redirect = false;
  let keepForm = false;
  let responseStatus = 200;
  const html = await readFile(new URL('./fixtures/sample-form.html', import.meta.url), 'utf8');
  const sections = await readFile(
    new URL('./fixtures/sections-form.html', import.meta.url),
    'utf8',
  );
  const googleLayout = await readFile(
    new URL('./fixtures/google-layout-form.html', import.meta.url),
    'utf8',
  );
  const server = createServer(async (req, res) => {
    if (req.url === '/submit' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      submitted.push(new URLSearchParams(body));
      if (redirect) {
        res.writeHead(303, { Location: '/thanks' });
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.statusCode = responseStatus;
      const escaped = confirmation
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      res.end(unknown ? '<h1>Thank you</h1>' : `${keepForm ? html : ''}<h1>${escaped}</h1>`);
      return;
    }
    if (req.url === '/thanks') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<h1>${confirmation.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</h1>`,
      );
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      req.url?.startsWith('/sections')
        ? sections
        : req.url?.startsWith('/google')
          ? googleLayout
          : html,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not listen');
  return {
    url: `http://127.0.0.1:${address.port}/form`,
    submitted,
    setUnknown: (value: boolean) => {
      unknown = value;
    },
    setConfirmation: (value: string) => {
      confirmation = value;
    },
    setRedirect: (value: boolean) => {
      redirect = value;
    },
    setKeepForm: (value: boolean) => {
      keepForm = value;
    },
    setResponseStatus: (value: number) => {
      responseStatus = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
