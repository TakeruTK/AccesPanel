const fs = require("fs");
const path = require("path");

const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

function ensureUploadsDir() {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

function createStoredFileName(originalName) {
  const timestamp = Date.now();
  const safeName = String(originalName || "archivo")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");

  return `${timestamp}-${safeName}`;
}

module.exports = {
  createStoredFileName,
  ensureUploadsDir,
  uploadsRoot,
};
