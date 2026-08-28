// 静态资源路径解析（支持子路径部署，避免 /vendor 绝对路径 404）
const BASE = new URL('../', import.meta.url);

export function assetUrl(relativePath) {
  return new URL(relativePath.replace(/^\.\//, ''), BASE).href;
}

export function vendorUrl(subpath) {
  const p = subpath.startsWith('vendor/') ? subpath : 'vendor/' + subpath.replace(/^\//, '');
  return assetUrl(p);
}
