/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // BACKEND_URL points at your FastAPI server (e.g. your Render URL, no trailing slash).
    // Locally, put BACKEND_URL=http://127.0.0.1:8000 in a .env.local file.
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;