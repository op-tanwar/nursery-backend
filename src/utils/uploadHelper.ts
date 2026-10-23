import fs from "node:fs";
import path from "node:path";
import { UploadedFile } from "express-fileupload";
import cloudinary from "cloudinary";
import { TDocumentType } from "../types/nursery.types";

export const ALLOWED_DOCUMENT_KEYS: TDocumentType[] = [
  "gstin",
  "panCard",
  "nurseryLicense",
  "identityProof",
  "bankDetails",
];

export const ALLOWED_DOC_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

export const ALLOWED_DOC_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Safely delete a temporary file from disk
 */
export const cleanupTempFile = (filePath?: string): void => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`[uploadHelper] Failed to delete temp file ${filePath}:`, err);
  }
};

/**
 * Reusable Cloudinary upload helper for express-fileupload files
 * Automatically cleans up local temp file after upload
 */
export const uploadToCloudinary = async (
  file: UploadedFile,
  folder = "urban-nursery/documents"
): Promise<{ url: string; publicId: string }> => {
  try {
    const result = await cloudinary.v2.uploader.upload(file.tempFilePath, {
      folder,
      resource_type: "auto",
      use_filename: true,
      unique_filename: true,
    });

    return {
      url: result.secure_url || result.url,
      publicId: result.public_id,
    };
  } finally {
    // Automatically clean up local temporary file
    cleanupTempFile(file.tempFilePath);
  }
};

/**
 * Delete a document or image from Cloudinary by public ID
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  if (!publicId) return;
  try {
    const res = await cloudinary.v2.uploader.destroy(publicId, { resource_type: "image" });
    if (res.result !== "ok") {
      await cloudinary.v2.uploader.destroy(publicId, { resource_type: "raw" });
    }
  } catch (error) {
    console.error(`[Cloudinary] Failed to delete asset with publicId ${publicId}:`, error);
  }
};
