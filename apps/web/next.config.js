/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000', 'resonance-production-fce2.up.railway.app'] },
    cpus: 1,
    // Browser-native cross-fade on tab/route navigation. Falls back to
    // an instant cut on browsers that don't support it (Safari < 18, etc.)
    // so this is safe to ship unconditionally.
    viewTransition: true,
  },
  transpilePackages: [
    'react-native-web',
    '@resonance/core',
    '@resonance/theme',
    '@resonance/ui',
    '@resonance/screens',
  ],
  typescript: {
    // Types are verified locally via tsc --noEmit.
    // The Railway build doesn't have @types/react-native.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': 'react-native-web',
    };
    return config;
  },
};

module.exports = nextConfig;
