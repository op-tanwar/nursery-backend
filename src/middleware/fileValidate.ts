// src/middleware/fileValidate.ts
import express from "express";
import path from "node:path";
import { UploadedFile } from "express-fileupload";
import ErrorHandler from "../utils/errorHandler";

export const validateUploadedFiles = (options?: { allowVideo?: boolean }) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.files || Object.keys(req.files).length === 0) return next();

    // Check if route context explicitly permits video uploads (e.g. unboxing / damage claims)
    const isClaimRoute = Boolean(
      req.originalUrl?.includes("/orders/claim") ||
      req.originalUrl?.includes("/claims") ||
      req.originalUrl?.includes("/returns") ||
      req.originalUrl?.includes("/return-replacement") ||
      req.path?.includes("/claim") ||
      req.path?.includes("/return") ||
      (req.baseUrl?.includes("/orders") && req.path?.includes("/claim"))
    );
    const allowVideo = Boolean(options?.allowVideo || isClaimRoute);

    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "image/gif",
      "application/pdf",
    ];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"];

    if (allowVideo) {
      allowedMimeTypes.push(
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-matroska",
        "video/avi",
        "video/mpeg"
      );
      allowedExtensions.push(".mp4", ".webm", ".mov", ".mkv", ".avi");
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
        const typeDesc = allowVideo
          ? "images, PDFs, and approved video formats (mp4, webm, mov)"
          : "images and PDFs";
        return next(
          new ErrorHandler(`Security Exception: Invalid file payload type context. Only ${typeDesc} are allowed.`, 400)
        );
      }
    }
    next();
  };
};
