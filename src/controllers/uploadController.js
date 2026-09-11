/**
 * Upload Controller — admin image uploads (e.g. Open Graph image, logos)
 */
const logger = require("../utils/logger");

/**
 * POST /api/admin/upload  (multipart, field name: "file")
 * Returns { path: "/uploads/x.jpg", url: "https://host/uploads/x.jpg" }
 */
async function uploadImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const relPath = `/uploads/${req.file.filename}`;

    // Absolute URL (used for OG/meta tags, which require an absolute URL)
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const absoluteUrl = `${proto}://${host}${relPath}`;

    res.json({
      success: true,
      data: {
        path: relPath,
        url: absoluteUrl,
        filename: req.file.filename,
        size: req.file.size,
      },
    });
  } catch (err) {
    logger.error("upload.uploadImage error:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
}

module.exports = { uploadImage };
