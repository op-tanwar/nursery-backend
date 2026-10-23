import { Request, Response, NextFunction } from "express";
import path from "node:path";
import { UploadedFile } from "express-fileupload";
import ErrorHandler from "../utils/errorHandler";
import {
  ALLOWED_DOCUMENT_KEYS,
  ALLOWED_DOC_MIME_TYPES,
  ALLOWED_DOC_EXTENSIONS,
  MAX_DOCUMENT_FILE_SIZE,
} from "../utils/uploadHelper";
import { TDocumentType } from "../types/nursery.types";

/**
 * Middleware to validate nursery document uploads
 */
export const validateNurseryDocumentsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const files: any = req.files ? (Array.isArray(req.files) ? {} : req.files) : {};
  const body: any = req.body || {};

  const gstinFile = files["gstin"] || files.gstin || null;
  const panCardFile = files["panCard"] || files.panCard || null;
  const licenseFile = files["nurseryLicense"] || files.nurseryLicense || null;
  const idProofFile = files["identityProof"] || files.identityProof || null;
  const bankDetailsFile = files["bankDetails"] || files.bankDetails || null;

  const hasAnyUploadedFile = Boolean(
    gstinFile || panCardFile || licenseFile || idProofFile || bankDetailsFile
  );
  const bodyHasDocs = ALLOWED_DOCUMENT_KEYS.some((key) => Boolean(body?.[key]));

  if (!hasAnyUploadedFile && !bodyHasDocs) {
    return next(
      new ErrorHandler(
        `Please provide at least one valid document file (${ALLOWED_DOCUMENT_KEYS.join(", ")}) to upload.`,
        400
      )
    );
  }

  // Validate each file provided
  for (const [key, value] of Object.entries(files)) {
    if (!value) continue;
    if (!ALLOWED_DOCUMENT_KEYS.includes(key as TDocumentType)) {
      return next(
        new ErrorHandler(
          `Invalid document field name '${key}'. Allowed fields: ${ALLOWED_DOCUMENT_KEYS.join(", ")}.`,
          400
        )
      );
    }

    const fileList: UploadedFile[] = Array.isArray(value) ? value : [value];

    for (const file of fileList) {
      const fileExt = path.extname(file.name).toLowerCase();

      if (!ALLOWED_DOC_MIME_TYPES.includes(file.mimetype) || !ALLOWED_DOC_EXTENSIONS.includes(fileExt)) {
        return next(
          new ErrorHandler(
            `Invalid file format for '${key}'. Supported formats are PDF, JPEG, PNG, WEBP.`,
            400
          )
        );
      }

      if (file.size > MAX_DOCUMENT_FILE_SIZE) {
        return next(
          new ErrorHandler(
            `File size for '${key}' exceeds 10MB limit. Please upload a smaller file.`,
            400
          )
        );
      }
    }
  }

  next();
};
