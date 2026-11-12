export async function imageForUpload(file: File) {
  if (
    !["image/jpeg", "image/png"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw Error("ใช้รูป JPEG/PNG ขนาดไม่เกิน 8 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(Error("อ่านรูปไม่สำเร็จ"))),
        "image/jpeg",
        0.86,
      ),
    );
    if (blob.size > 524288)
      throw Error("รูปหลังย่อเกิน 512 KB กรุณาเลือกรูปอื่น");
    return blob;
  } finally {
    bitmap.close();
  }
}
