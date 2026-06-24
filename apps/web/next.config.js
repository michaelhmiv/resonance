/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    cpus: 1,
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
