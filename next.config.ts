import type { NextConfig } from 'next'

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '4.2mb' } }
}
export default config
