// Header validation bounds decoded image size before a reviewer opens the file.
// This is not malware scanning or proof that the image depicts a real person.
export function validEvidenceImage(
  bytes: Uint8Array,
  mime: string | undefined,
) {
  const size = (width: number, height: number) =>
    width > 0 &&
    height > 0 &&
    width <= 4096 &&
    height <= 4096 &&
    width * height <= 12000000;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") {
    if (
      bytes.length < 33 ||
      [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b) ||
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" ||
      !size(view.getUint32(16), view.getUint32(20))
    )
      return false;
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) return false;
      const type = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      );
      if (type === "acTL") return false;
      offset += length + 12;
      if (type === "IEND") return offset === bytes.length;
    }
    return false;
  }
  if (
    mime !== "image/jpeg" ||
    bytes.length < 12 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216
  )
    return false;
  let offset = 2,
    frame = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) return false;
    if (marker === 218) return frame;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      if (
        frame ||
        length < 8 ||
        !size(view.getUint16(offset + 5), view.getUint16(offset + 3))
      )
        return false;
      frame = true;
    }
    offset += length;
  }
  return false;
}
