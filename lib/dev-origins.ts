const defaultDevOrigins = ['localhost', '127.0.0.1', '10.103.0.9'];

export function getAllowedDevOrigins(value = process.env.NOVA3D_DEV_ORIGINS) {
  const raw = value?.trim() ? value : defaultDevOrigins.join(',');
  return [...new Set(raw.split(',').map((origin) => origin.trim()).filter(Boolean))];
}
