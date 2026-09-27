/* config-helpers.mjs: Pure helpers for reading and patching this plugin's config in the settings UI. */

export const projectors = (config) => (Array.isArray(config?.projectors) ? config.projectors : []);

export const primaryProjector = (config) => projectors(config)[0];

export const hasProjector = (config) => projectors(config).some((projector) => (typeof projector?.host === "string") && (projector.host.trim().length > 0));

// Replace the first projector's connection settings, keeping any other settings and projectors.
export const withPrimaryProjector = (config, { host, name, password }) => {

  const next = [...projectors(config)];

  next[0] = { ...next[0], host, name, password: password || undefined };

  return { projectors: next };
};
