/** 官方裁图接口可能直接返回栅格图片，不接受脚本、SVG 或任意文件地址。 */
export function embeddedImageData(uri: string): { base64: string; extension: string } | undefined {
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(uri);
  if (!match || match[2].length % 4 !== 0) return undefined;
  return { base64: match[2], extension: /^jpe?g$/i.test(match[1]) ? 'jpg' : match[1].toLowerCase() };
}
