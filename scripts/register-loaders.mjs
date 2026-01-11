import { register as registerTsx } from 'tsx/esm/api';
import { register } from 'node:module';

registerTsx();
register(new URL('./md-raw-loader.mjs', import.meta.url).href, {
  parentURL: import.meta.url,
});
