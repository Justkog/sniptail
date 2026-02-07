import { register } from 'node:module';

try {
  const { register: registerTsx } = await import('tsx/esm/api');
  registerTsx();
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') {
    throw error;
  }
}
register(new URL('./md-raw-loader.mjs', import.meta.url).href, {
  parentURL: import.meta.url,
});
