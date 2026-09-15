import type {NextConfig} from 'next';
import {getAllowedDevOrigins} from './lib/dev-origins';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
