import type { Plugin } from '@omni-queue/core';

export function composePlugins(
  ...plugins: Array<Plugin | Plugin[] | null | undefined | false>
): Plugin[] {
  return plugins.flatMap((plugin) => {
    if (!plugin) return [];
    return Array.isArray(plugin) ? plugin.filter(Boolean) : [plugin];
  });
}
