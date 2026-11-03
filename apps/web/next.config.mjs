import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const api = new URL(process.env.API_PROXY_URL || 'http://127.0.0.1:4000');
if (!['http:', 'https:'].includes(api.protocol))
  throw new Error('API_PROXY_URL must be HTTP or HTTPS');
export default {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: '26mb' },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: api.origin + '/api/:path*' },
      { source: '/socket.io', destination: api.origin + '/socket.io/' },
    ];
  },
};
