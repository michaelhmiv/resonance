/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native addon (.node); keep it external to webpack so
  // it loads from node_modules at runtime instead of being bundled.
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: [
    'react-native-web',
    '@resonance/core',
    '@resonance/theme',
    '@resonance/ui',
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
