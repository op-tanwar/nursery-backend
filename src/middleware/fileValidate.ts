// src/middleware/fileValidate.ts
import express from "express";
import path from "node:path";
import { UploadedFile } from "express-fileupload";
import ErrorHandler from "../utils/errorHandler";

export const validateUploadedFiles = (options?: { allowVideo?: boolean }) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.files || Object.keys(req.files).length === 0) return next();

    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "application/pdf",
    ];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

    if (options?.allowVideo) {
      allowedMimeTypes.push("video/mp4", "video/webm", "video/quicktime");
      allowedExtensions.push(".mp4", ".webm", ".mov");
    }

    const filesArray: UploadedFile[] = [];

    for (const key of Object.keys(req.files)) {
      const fileItem = req.files[key];
      if (Array.isArray(fileItem)) {
        filesArray.push(...fileItem);
      } else {
        filesArray.push(fileItem);
      }
    }

    for (const file of filesArray) {
      const fileExt = path.extname(file.name).toLowerCase();
      if (!allowedMimeTypes.includes(file.mimetype) || !allowedExtensions.includes(fileExt)) {
        return next(new ErrorHandler("Security Exception: Invalid file payload type context.", 400));
      }
    }
    next();
  };
};